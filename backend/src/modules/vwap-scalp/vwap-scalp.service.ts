import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { VwapScalpRun, VwapScalpRunDocument, VSStatus } from './schemas/vwap-scalp-run.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { ema, rsi, OHLCV } from '../strategies/indicators';
import {
  bsPrice, itmStrike, calcVWAP, calcSupertrend, calcORB,
  istHHMM, istDayOfWeek, isNewDay,
} from '../strategies/option-indicators';

// ── Strategy C: VWAP Pullback Scalping ────────────────────────────────────────
//
//  After the ORB is established (first 3 bars = 15 min), waits for the ORB
//  breakout direction to be confirmed (price breaks above ORB high or below ORB low).
//  Then trades every VWAP pullback and bounce in the ORB direction:
//    CALL: price dips near/below VWAP, then next bar closes above VWAP
//          + EMA9 > EMA21 + RSI 40–75 + ORB breakout up already occurred
//    PUT:  price rises near/above VWAP, then next bar closes below VWAP
//          + EMA9 < EMA21 + RSI 25–60 + ORB breakout down already occurred
//
//  Tighter risk management vs original:
//    SL at 30% of entry premium (was 45%)
//    Partial TP at 1.5× (was 1.8×)
//  Max 3 trades/day, 20-min cooldown after each exit.

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 25, tickSize: 50  },
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 15, tickSize: 100 },
] as const;

const RISK_FREE_RATE      = 0.07;
const MAX_RISK_PER_TRADE  = 4000;
const SL_PCT              = 0.30;   // tighter SL
const PARTIAL_MULT        = 1.5;    // earlier partial TP
const ENTRY_FROM          = 945;    // entry after first 30 min (ORB + initial breakout)
const ENTRY_TO            = 1400;
const EXIT_TIME           = 1500;
const VIX_MAX             = 22;     // slightly wider — scalping handles vol better
const VWAP_TOUCH_PCT      = 0.003;  // within 0.3% of VWAP counts as a "touch"
const MAX_TRADES_PER_DAY  = 3;
const COOLDOWN_MS         = 20 * 60 * 1000;
const ST_PERIOD           = 10;
const ST_MULT             = 3;
const EMA_FAST            = 9;
const EMA_SLOW            = 21;
const RSI_PERIOD          = 14;

interface VSTrade {
  symbol: string; direction: 'CALL' | 'PUT'; entryTime: string; exitTime: string;
  strike: number; entryPremium: number; exitPremium: number; lots: number;
  lotSize: number; grossPnl: number; netPnl: number;
  exitReason: 'SL' | 'TARGET' | 'TRAIL_SL' | 'EOD'; vix: number;
  meta: Record<string, number | string>;
}

interface OpenVSTrade {
  direction: 'CALL' | 'PUT'; strike: number; entryPremium: number; entryTime: Date;
  slPremium: number; targetPremium: number; lots: number; partialBooked: boolean;
  trailSL: boolean; vix: number; meta: Record<string, number | string>;
}

function mean(a: number[]) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stdDev(a: number[]) {
  if (a.length < 2) return 0; const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function computeMetrics(trades: VSTrade[], init: number) {
  if (!trades.length) return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0, maxDrawdown: 0, sharpeRatio: 0, roi: 0, finalCapital: init };
  const wins = trades.filter(t => t.netPnl > 0), losses = trades.filter(t => t.netPnl <= 0);
  const gp = wins.reduce((s, t) => s + t.netPnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  let eq = init, pk = init, dd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) { eq += t.netPnl; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const dayPnl = new Map<string, number>();
  trades.forEach(t => dayPnl.set(t.exitTime.slice(0, 10), (dayPnl.get(t.exitTime.slice(0, 10)) ?? 0) + t.netPnl));
  const RFDR = 0.065 / 252; let re = init; const dr: number[] = [];
  for (const [, p] of [...dayPnl.entries()].sort()) { dr.push(p / re - RFDR); re += p; }
  const sh = dr.length > 1 ? +(mean(dr) / (stdDev(dr) || 1e-10) * Math.sqrt(252)).toFixed(2) : 0;
  return { totalTrades: trades.length, wins: wins.length, losses: losses.length, winRate: +((wins.length / trades.length) * 100).toFixed(1), netPnl: +(gp - gl).toFixed(2), grossProfit: +gp.toFixed(2), grossLoss: +gl.toFixed(2), profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : 99, avgWin: wins.length ? +(gp / wins.length).toFixed(2) : 0, avgLoss: losses.length ? +(gl / losses.length).toFixed(2) : 0, expectancy: +((gp - gl) / trades.length).toFixed(2), maxDrawdown: +dd.toFixed(2), sharpeRatio: sh, roi: +(((gp - gl) / init) * 100).toFixed(2), finalCapital: +(init + (gp - gl)).toFixed(2) };
}

@Injectable()
export class VwapScalpService {
  private readonly logger = new Logger(VwapScalpService.name);

  constructor(
    @InjectModel(VwapScalpRun.name) private runModel: Model<VwapScalpRunDocument>,
    private marketData: MarketDataService,
  ) {}

  async run(userId: string, fromDate: string, toDate: string) {
    const record = await this.runModel.create({ userId: new Types.ObjectId(userId), fromDate: new Date(fromDate), toDate: new Date(toDate), status: VSStatus.QUEUED });
    void this.execute(record._id.toString(), fromDate, toDate);
    return record;
  }

  async get(id: string) { return this.runModel.findById(id); }

  async list(userId: string) {
    return this.runModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(20).select('-trades');
  }

  private async execute(runId: string, fromDate: string, toDate: string) {
    await this.runModel.findByIdAndUpdate(runId, { status: VSStatus.RUNNING });
    try {
      const from = new Date(fromDate), to = new Date(toDate);
      const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
      const vixMap = new Map<string, number>();
      for (const v of vixBars) vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);
      const allTrades: VSTrade[] = [];
      for (const inst of INSTRUMENTS) {
        const trades = await this.simulateInstrument(inst, from, to, vixMap);
        allTrades.push(...trades);
        this.logger.log(`VwapScalp ${inst.symbol}: ${trades.length} trades`);
      }
      allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));
      let equity = 1_000_000;
      const equityCurve: { t: string; e: number }[] = [];
      for (const t of [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) { equity += t.netPnl; equityCurve.push({ t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) }); }
      await this.runModel.findByIdAndUpdate(runId, { status: VSStatus.COMPLETED, metrics: { ...computeMetrics(allTrades, 1_000_000), equityCurve }, trades: allTrades });
    } catch (err: any) {
      this.logger.error(`VwapScalp ${runId} failed: ${err.message}`);
      await this.runModel.findByIdAndUpdate(runId, { status: VSStatus.FAILED, errorMessage: err.message });
    }
  }

  private async simulateInstrument(inst: typeof INSTRUMENTS[number], from: Date, to: Date, vixMap: Map<string, number>): Promise<VSTrade[]> {
    const lookback = new Date(from); lookback.setMonth(lookback.getMonth() - 1);
    const bars5 = await this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookback, to);
    if (bars5.length < 50) return [];

    const trades: VSTrade[] = [];
    let sessionBars: OHLCV[] = [], prevBar: typeof bars5[0] | null = null;
    const rollingBars: OHLCV[] = [];
    let orbHigh = 0, orbLow = 0, orbSet = false;
    let orbBreakUp = false, orbBreakDown = false;
    let prevVwapVal = 0, prevClose = 0;
    let openTrade: OpenVSTrade | null = null;
    let tradesOpenedToday = 0, lastTradeExitTime: Date | null = null;

    for (const bar of bars5) {
      const barDate = bar.timestamp, hhmm = istHHMM(barDate), dow = istDayOfWeek(barDate);
      const ohlcv: OHLCV = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };

      if (!prevBar || isNewDay(prevBar.timestamp, barDate)) {
        if (openTrade && prevBar) {
          const T = this.tte(prevBar.timestamp);
          const ep = bsPrice(prevBar.close, openTrade.strike, RISK_FREE_RATE, T, 0.15, openTrade.direction === 'CALL' ? 'call' : 'put');
          trades.push(this.mk(inst, openTrade, ep, prevBar.timestamp, 'EOD'));
          lastTradeExitTime = prevBar.timestamp; openTrade = null;
        }
        sessionBars = []; orbSet = false; orbHigh = orbLow = 0;
        orbBreakUp = orbBreakDown = false; prevVwapVal = 0; prevClose = 0;
        tradesOpenedToday = 0; lastTradeExitTime = null;
      }
      prevBar = bar;
      rollingBars.push(ohlcv); if (rollingBars.length > 200) rollingBars.shift();

      if (barDate < from) { sessionBars.push(ohlcv); continue; }
      if (dow === 0 || dow === 5 || dow === 6) continue;
      const vix = vixMap.get(barDate.toISOString().slice(0, 10)) ?? 15;
      if (vix > VIX_MAX) { sessionBars.push(ohlcv); prevClose = bar.close; continue; }

      // Compute VWAP before pushing current bar (gives previous bar's VWAP)
      const prevVwapArr = calcVWAP(sessionBars);
      prevVwapVal = prevVwapArr.length > 0 ? prevVwapArr[prevVwapArr.length - 1] : 0;

      sessionBars.push(ohlcv);

      // ── 15-min ORB: first 3 session bars ────────────────────────────────────
      if (!orbSet && sessionBars.length >= 3 && hhmm >= 930) {
        const orb = calcORB(sessionBars, 3); orbHigh = orb.high; orbLow = orb.low; orbSet = true;
      }

      // Track ORB breakout direction
      if (orbSet) {
        if (bar.close > orbHigh) orbBreakUp = true;
        if (bar.close < orbLow)  orbBreakDown = true;
      }

      const vwArr = calcVWAP(sessionBars);
      const vwapVal = vwArr[vwArr.length - 1];

      if (openTrade) {
        const T = this.tte(barDate);
        const cp = bsPrice(bar.close, openTrade.strike, RISK_FREE_RATE, T, vix / 100, openTrade.direction === 'CALL' ? 'call' : 'put');
        if (!openTrade.partialBooked && cp >= openTrade.entryPremium * PARTIAL_MULT) { openTrade.partialBooked = true; openTrade.trailSL = true; openTrade.slPremium = openTrade.entryPremium; openTrade.lots = Math.max(1, Math.floor(openTrade.lots / 2)); }
        if (cp <= openTrade.slPremium) { trades.push(this.mk(inst, openTrade, openTrade.slPremium, barDate, openTrade.trailSL ? 'TRAIL_SL' : 'SL')); lastTradeExitTime = barDate; openTrade = null; }
        else if (hhmm >= EXIT_TIME) { trades.push(this.mk(inst, openTrade, cp, barDate, 'EOD')); lastTradeExitTime = barDate; openTrade = null; }
        prevClose = bar.close;
        continue;
      }

      if (!orbSet || hhmm < ENTRY_FROM || hhmm > ENTRY_TO) { prevClose = bar.close; continue; }
      if (tradesOpenedToday >= MAX_TRADES_PER_DAY) { prevClose = bar.close; continue; }
      if (lastTradeExitTime && barDate.getTime() - lastTradeExitTime.getTime() < COOLDOWN_MS) { prevClose = bar.close; continue; }
      if (rollingBars.length < Math.max(EMA_SLOW, RSI_PERIOD, ST_PERIOD * 2) + 5 || !vwapVal || !prevVwapVal || !prevClose) { prevClose = bar.close; continue; }

      const rc = rollingBars.map(b => b.close);
      const efArr = ema(rc, EMA_FAST), esArr = ema(rc, EMA_SLOW), rvArr = rsi(rc, RSI_PERIOD);
      const st = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT);
      const efN = efArr[efArr.length - 1], esN = esArr[esArr.length - 1];
      const rsiV = rvArr[rvArr.length - 1], tN = st.trend[st.trend.length - 1];
      if (!efN || !esN || !rsiV || tN === 0) { prevClose = bar.close; continue; }

      // ── VWAP bounce detection ────────────────────────────────────────────────
      // CALL bounce: prev bar was at/below VWAP (within touch%), current closes above VWAP
      const prevNearVwapLow  = prevClose <= prevVwapVal * (1 + VWAP_TOUCH_PCT);
      const currAboveVwap    = bar.close > vwapVal;
      // PUT bounce: prev bar was at/above VWAP, current closes below VWAP
      const prevNearVwapHigh = prevClose >= prevVwapVal * (1 - VWAP_TOUCH_PCT);
      const currBelowVwap    = bar.close < vwapVal;

      // CALL: VWAP bounce up + ORB already broke up + EMA bull + ST bull + RSI not overbought
      const callOk =
        prevNearVwapLow && currAboveVwap && orbBreakUp &&
        efN > esN && tN === 1 && rsiV > 40 && rsiV < 75;

      // PUT: VWAP bounce down + ORB already broke down + EMA bear + ST bear + RSI not oversold
      const putOk =
        prevNearVwapHigh && currBelowVwap && orbBreakDown &&
        efN < esN && tN === -1 && rsiV > 25 && rsiV < 60;

      prevClose = bar.close;
      if (!callOk && !putOk) continue;

      const dir: 'CALL' | 'PUT' = callOk ? 'CALL' : 'PUT';
      const strike = itmStrike(bar.close, dir, inst.tickSize);
      const T = this.tte(barDate);
      const ep = bsPrice(bar.close, strike, RISK_FREE_RATE, T, vix / 100, dir === 'CALL' ? 'call' : 'put');
      if (ep < 10) continue;
      const slP = +(ep * SL_PCT).toFixed(2);
      const lots = Math.max(1, Math.floor(MAX_RISK_PER_TRADE / ((ep - slP) * inst.lotSize)));
      tradesOpenedToday++;
      openTrade = { direction: dir, strike, entryPremium: +ep.toFixed(2), entryTime: barDate, slPremium: slP, targetPremium: +(ep * 2.0).toFixed(2), lots, partialBooked: false, trailSL: false, vix, meta: { orbHigh: +orbHigh.toFixed(2), orbLow: +orbLow.toFixed(2), vwap: +vwapVal.toFixed(2), prevClose: +prevClose.toFixed(2), ema9: +efN.toFixed(2), ema21: +esN.toFixed(2), rsi: +rsiV.toFixed(1), orbBreakUp: orbBreakUp ? 1 : 0, orbBreakDown: orbBreakDown ? 1 : 0, tradeNo: tradesOpenedToday } };
    }
    return trades;
  }

  private mk(inst: typeof INSTRUMENTS[number], t: OpenVSTrade, exitPrem: number, exitTime: Date, reason: VSTrade['exitReason']): VSTrade {
    const gp = (exitPrem - t.entryPremium) * t.lots * inst.lotSize;
    return { symbol: inst.symbol, direction: t.direction, entryTime: t.entryTime.toISOString(), exitTime: exitTime.toISOString(), strike: t.strike, entryPremium: t.entryPremium, exitPremium: +exitPrem.toFixed(2), lots: t.lots, lotSize: inst.lotSize, grossPnl: +gp.toFixed(2), netPnl: +(gp - 40 * t.lots).toFixed(2), exitReason: reason, vix: t.vix, meta: t.meta };
  }

  private tte(date: Date): number {
    const ist = new Date(date.getTime() + 5.5 * 3600000), dow = ist.getUTCDay();
    const dtt = ((4 - dow + 7) % 7) || 7, hl = 15.5 - (ist.getUTCHours() + ist.getUTCMinutes() / 60);
    return Math.max((dtt - 1 + hl / 6.25) / 365, 1 / 365);
  }
}
