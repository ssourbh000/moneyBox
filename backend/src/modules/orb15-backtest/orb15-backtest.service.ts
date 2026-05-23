import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Orb15BacktestRun, Orb15BacktestRunDocument, O15Status } from './schemas/orb15-backtest-run.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { ema, rsi, adx, atr, OHLCV } from '../strategies/indicators';
import {
  bsPrice, itmStrike, calcVWAP, calcSupertrend, calcORB,
  istHHMM, istDayOfWeek, isNewDay,
} from '../strategies/option-indicators';

// ── Strategy B v2: 45-minute ORB + Multi-Timeframe + Volume ──────────────────
//
//  All v1 filters (ADX > 20, ATR SL, 20% trail) plus:
//    • 15-min EMA(9)/EMA(21) alignment — multi-timeframe trend confirmation
//    • Volume surge: entry bar volume > 1.5× 20-bar rolling average
//    • RSI thresholds tightened: > 60 (bull) / < 40 (bear) on 5-min
//    • Previous Day High/Low break: price must clear PDH (CALL) or PDL (PUT)
//    • Gap direction bias: large gaps lock direction (gap-up → CALL only, gap-down → PUT only)

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 25, tickSize: 50  },
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 15, tickSize: 100 },
] as const;

const RISK_FREE_RATE     = 0.07;
const MAX_RISK_PER_TRADE = 4000;
const SL_PCT             = 0.45;
const TRAIL_PCT          = 0.20;   // trail SL at 20% below running peak premium
const PARTIAL_MULT       = 1.8;
const ORB_BARS           = 9;      // 9 × 5min = 45-min opening range
const ENTRY_FROM         = 1000;   // entry after ORB is set (10:00 AM)
const ENTRY_TO           = 1400;
const EXIT_TIME          = 1500;
const VIX_MAX            = 20;
const RSI_BULL           = 60;   // tightened from 50 → stronger momentum required
const RSI_BEAR           = 40;   // tightened from 50 → stronger momentum required
const VOL_SURGE          = 1.5;  // entry bar volume must be > 1.5× rolling avg
const VOL_AVG_BARS       = 20;   // rolling window for volume average
const GAP_THRESHOLD      = 0.005; // 0.5% gap locks direction for the day
const MAX_TRADES_PER_DAY = 3;
const COOLDOWN_MS        = 20 * 60 * 1000;
const ST_PERIOD          = 10;
const ST_MULT            = 3;
const EMA_FAST           = 9;
const EMA_SLOW           = 21;
const RSI_PERIOD         = 14;

interface O15Trade {
  symbol: string; direction: 'CALL' | 'PUT'; entryTime: string; exitTime: string;
  strike: number; entryPremium: number; exitPremium: number; lots: number;
  lotSize: number; grossPnl: number; netPnl: number;
  exitReason: 'SL' | 'TARGET' | 'TRAIL_SL' | 'EOD'; vix: number;
  meta: Record<string, number | string>;
}

interface OpenO15Trade {
  direction: 'CALL' | 'PUT'; strike: number; entryPremium: number; entryTime: Date;
  slPremium: number; targetPremium: number; lots: number; partialBooked: boolean;
  trailSL: boolean; peakPremium: number; vix: number; meta: Record<string, number | string>;
}

function mean(a: number[]) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stdDev(a: number[]) {
  if (a.length < 2) return 0; const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function computeMetrics(trades: O15Trade[], init: number) {
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
export class Orb15BacktestService {
  private readonly logger = new Logger(Orb15BacktestService.name);

  constructor(
    @InjectModel(Orb15BacktestRun.name) private runModel: Model<Orb15BacktestRunDocument>,
    private marketData: MarketDataService,
  ) {}

  async run(userId: string, fromDate: string, toDate: string) {
    const record = await this.runModel.create({ userId: new Types.ObjectId(userId), fromDate: new Date(fromDate), toDate: new Date(toDate), status: O15Status.QUEUED });
    void this.execute(record._id.toString(), fromDate, toDate);
    return record;
  }

  async get(id: string) { return this.runModel.findById(id); }

  async list(userId: string) {
    return this.runModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(20).select('-trades');
  }

  private async execute(runId: string, fromDate: string, toDate: string) {
    await this.runModel.findByIdAndUpdate(runId, { status: O15Status.RUNNING });
    try {
      const from = new Date(fromDate), to = new Date(toDate);
      const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
      const vixMap = new Map<string, number>();
      for (const v of vixBars) vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);
      const allTrades: O15Trade[] = [];
      for (const inst of INSTRUMENTS) {
        const trades = await this.simulateInstrument(inst, from, to, vixMap);
        allTrades.push(...trades);
        this.logger.log(`ORB45 ${inst.symbol}: ${trades.length} trades`);
      }
      allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));
      let equity = 1_000_000;
      const equityCurve: { t: string; e: number }[] = [];
      for (const t of [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) { equity += t.netPnl; equityCurve.push({ t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) }); }
      await this.runModel.findByIdAndUpdate(runId, { status: O15Status.COMPLETED, metrics: { ...computeMetrics(allTrades, 1_000_000), equityCurve }, trades: allTrades });
    } catch (err: any) {
      this.logger.error(`Orb15Backtest ${runId} failed: ${err.message}`);
      await this.runModel.findByIdAndUpdate(runId, { status: O15Status.FAILED, errorMessage: err.message });
    }
  }

  private async simulateInstrument(inst: typeof INSTRUMENTS[number], from: Date, to: Date, vixMap: Map<string, number>): Promise<O15Trade[]> {
    const lookback = new Date(from); lookback.setMonth(lookback.getMonth() - 1);
    const [bars5, bars15] = await Promise.all([
      this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookback, to),
      this.marketData.getCandles(inst.symbol, inst.exchange, '15minute', lookback, to),
    ]);
    if (bars5.length < 50) return [];

    const trades: O15Trade[] = [];
    let sessionBars: OHLCV[] = [], prevBar: typeof bars5[0] | null = null;
    const rollingBars: OHLCV[] = [];
    const rolling15: OHLCV[] = [];
    let bar15Idx = 0;
    let orbHigh = 0, orbLow = 0, orbSet = false;
    let openTrade: OpenO15Trade | null = null;
    let tradesOpenedToday = 0, lastTradeExitTime: Date | null = null;
    // PDH/PDL and gap tracking
    let pdHigh = 0, pdLow = Infinity, dayHigh = 0, dayLow = Infinity;
    let prevDayClose = 0, todayOpen = 0;
    let gapDir: 'UP' | 'DOWN' | 'NONE' = 'NONE';

    for (const bar of bars5) {
      const barDate = bar.timestamp, hhmm = istHHMM(barDate), dow = istDayOfWeek(barDate);
      const ohlcv: OHLCV = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };

      // Advance 15-min bar pointer — include all 15-min bars up to current 5-min bar
      while (bar15Idx < bars15.length && bars15[bar15Idx].timestamp <= barDate) {
        const b = bars15[bar15Idx];
        rolling15.push({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
        if (rolling15.length > 150) rolling15.shift();
        bar15Idx++;
      }

      if (!prevBar || isNewDay(prevBar.timestamp, barDate)) {
        if (openTrade && prevBar) {
          const T = this.tte(prevBar.timestamp);
          const ep = bsPrice(prevBar.close, openTrade.strike, RISK_FREE_RATE, T, 0.15, openTrade.direction === 'CALL' ? 'call' : 'put');
          trades.push(this.mk(inst, openTrade, ep, prevBar.timestamp, 'EOD'));
          lastTradeExitTime = prevBar.timestamp; openTrade = null;
        }
        // Save previous day stats before reset
        if (dayHigh > 0) { pdHigh = dayHigh; pdLow = dayLow; prevDayClose = prevBar?.close ?? 0; }
        todayOpen = bar.open;
        // Gap direction: if today's open deviates > 0.5% from prev day close
        if (prevDayClose > 0) {
          const gapPct = (todayOpen - prevDayClose) / prevDayClose;
          gapDir = gapPct > GAP_THRESHOLD ? 'UP' : gapPct < -GAP_THRESHOLD ? 'DOWN' : 'NONE';
        }
        dayHigh = bar.high; dayLow = bar.low;
        sessionBars = []; orbSet = false; orbHigh = orbLow = 0;
        tradesOpenedToday = 0; lastTradeExitTime = null;
      } else {
        dayHigh = Math.max(dayHigh, bar.high);
        dayLow = Math.min(dayLow, bar.low);
      }
      prevBar = bar;
      rollingBars.push(ohlcv); if (rollingBars.length > 200) rollingBars.shift();

      if (barDate < from) { sessionBars.push(ohlcv); continue; }
      if (dow === 0 || dow === 5 || dow === 6) continue;
      const vix = vixMap.get(barDate.toISOString().slice(0, 10)) ?? 15;
      if (vix > VIX_MAX) { sessionBars.push(ohlcv); continue; }
      sessionBars.push(ohlcv);

      // ── 45-min ORB: wait for 9 session bars ─────────────────────────────────
      if (!orbSet && sessionBars.length >= ORB_BARS && hhmm >= ENTRY_FROM) {
        const orb = calcORB(sessionBars, ORB_BARS);
        orbHigh = orb.high; orbLow = orb.low; orbSet = true;
      }

      if (openTrade) {
        const T = this.tte(barDate);
        const cp = bsPrice(bar.close, openTrade.strike, RISK_FREE_RATE, T, vix / 100, openTrade.direction === 'CALL' ? 'call' : 'put');
        // Continuous trailing SL — update peak and ratchet SL up (never down)
        if (cp > openTrade.peakPremium) openTrade.peakPremium = cp;
        const contTrailSL = +(openTrade.peakPremium * (1 - TRAIL_PCT)).toFixed(2);
        if (contTrailSL > openTrade.slPremium) { openTrade.slPremium = contTrailSL; openTrade.trailSL = true; }
        // Partial TP at 1.8× — exit half lots
        if (!openTrade.partialBooked && cp >= openTrade.entryPremium * PARTIAL_MULT) { openTrade.partialBooked = true; openTrade.lots = Math.max(1, Math.floor(openTrade.lots / 2)); }
        if (cp <= openTrade.slPremium) { trades.push(this.mk(inst, openTrade, openTrade.slPremium, barDate, openTrade.trailSL ? 'TRAIL_SL' : 'SL')); lastTradeExitTime = barDate; openTrade = null; }
        else if (hhmm >= EXIT_TIME) { trades.push(this.mk(inst, openTrade, cp, barDate, 'EOD')); lastTradeExitTime = barDate; openTrade = null; }
        continue;
      }

      if (!orbSet || hhmm < ENTRY_FROM || hhmm > ENTRY_TO) continue;
      if (tradesOpenedToday >= MAX_TRADES_PER_DAY) continue;
      if (lastTradeExitTime && barDate.getTime() - lastTradeExitTime.getTime() < COOLDOWN_MS) continue;
      if (rollingBars.length < Math.max(EMA_SLOW, RSI_PERIOD, ST_PERIOD * 2) + 5) continue;

      const rc = rollingBars.map(b => b.close);
      const efArr = ema(rc, EMA_FAST), esArr = ema(rc, EMA_SLOW), rvArr = rsi(rc, RSI_PERIOD);
      const st = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT), vw = calcVWAP(sessionBars);
      const efN = efArr[efArr.length - 1], esN = esArr[esArr.length - 1];
      const rsiV = rvArr[rvArr.length - 1], vwV = vw[vw.length - 1];
      const tN = st.trend[st.trend.length - 1];
      if (!efN || !esN || !rsiV || !vwV || tN === 0) continue;

      // ── ADX filter: only trade when market is trending ───────────────────────
      const adxVal = adx(rollingBars, 14);
      if (adxVal < 20) continue;

      // ── Entry: ORB break + EMA + ST direction + VWAP + RSI (60/40) ──────────
      const callOk = bar.close > orbHigh && tN === 1 && efN > esN && bar.close > vwV && rsiV > RSI_BULL;
      const putOk  = bar.close < orbLow  && tN === -1 && efN < esN && bar.close < vwV && rsiV < RSI_BEAR;
      if (!callOk && !putOk) continue;

      // ── Gap direction lock: large gap → only trade with gap direction ─────────
      if (gapDir === 'UP' && putOk && !callOk) continue;
      if (gapDir === 'DOWN' && callOk && !putOk) continue;

      // ── PDH/PDL break: price must clear previous day's extreme ───────────────
      if (pdHigh > 0 && pdLow < Infinity) {
        if (callOk && bar.close <= pdHigh) continue;
        if (putOk  && bar.close >= pdLow)  continue;
      }

      // ── Volume surge: entry bar must show conviction (>1.5× avg volume) ──────
      const recentVols = rollingBars.slice(-VOL_AVG_BARS).map(b => b.volume);
      const volAvg = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
      if (volAvg > 0 && bar.volume < volAvg * VOL_SURGE) continue;

      // ── 15-min MTF EMA: higher-timeframe trend must align ────────────────────
      if (rolling15.length >= EMA_SLOW + 5) {
        const c15 = rolling15.map(b => b.close);
        const ef15 = ema(c15, EMA_FAST), es15 = ema(c15, EMA_SLOW);
        const ef15N = ef15[ef15.length - 1], es15N = es15[es15.length - 1];
        if (ef15N && es15N) {
          if (callOk && ef15N <= es15N) continue;
          if (putOk  && ef15N >= es15N) continue;
        }
      }

      const dir: 'CALL' | 'PUT' = callOk ? 'CALL' : 'PUT';
      const strike = itmStrike(bar.close, dir, inst.tickSize);
      const T = this.tte(barDate);
      const ep = bsPrice(bar.close, strike, RISK_FREE_RATE, T, vix / 100, dir === 'CALL' ? 'call' : 'put');
      if (ep < 10) continue;
      // ATR dynamic SL: tighter on low-vol days, wider on high-vol (range 25%–45%)
      const atrArr = atr(rollingBars, 14);
      const atrVal = atrArr[atrArr.length - 1] ?? 0;
      const atrPct = atrVal > 0 ? Math.min(atrVal / bar.close, 0.03) : 0.015;
      const dynSlPct = Math.max(0.25, Math.min(SL_PCT, atrPct * 15));
      const slP = +(ep * dynSlPct).toFixed(2);
      const lots = Math.max(1, Math.floor(MAX_RISK_PER_TRADE / ((ep - slP) * inst.lotSize)));
      tradesOpenedToday++;
      openTrade = { direction: dir, strike, entryPremium: +ep.toFixed(2), entryTime: barDate, slPremium: slP, targetPremium: +(ep * 2.5).toFixed(2), lots, partialBooked: false, trailSL: false, peakPremium: +ep.toFixed(2), vix, meta: { orbHigh: +orbHigh.toFixed(2), orbLow: +orbLow.toFixed(2), vwap: +vwV.toFixed(2), ema9: +efN.toFixed(2), ema21: +esN.toFixed(2), rsi: +rsiV.toFixed(1), orbBars: ORB_BARS, tradeNo: tradesOpenedToday, gapDir, adx: +adxVal.toFixed(1) } };
    }
    return trades;
  }

  private mk(inst: typeof INSTRUMENTS[number], t: OpenO15Trade, exitPrem: number, exitTime: Date, reason: O15Trade['exitReason']): O15Trade {
    const gp = (exitPrem - t.entryPremium) * t.lots * inst.lotSize;
    return { symbol: inst.symbol, direction: t.direction, entryTime: t.entryTime.toISOString(), exitTime: exitTime.toISOString(), strike: t.strike, entryPremium: t.entryPremium, exitPremium: +exitPrem.toFixed(2), lots: t.lots, lotSize: inst.lotSize, grossPnl: +gp.toFixed(2), netPnl: +(gp - 40 * t.lots).toFixed(2), exitReason: reason, vix: t.vix, meta: t.meta };
  }

  private tte(date: Date): number {
    const ist = new Date(date.getTime() + 5.5 * 3600000), dow = ist.getUTCDay();
    const dtt = ((4 - dow + 7) % 7) || 7, hl = 15.5 - (ist.getUTCHours() + ist.getUTCMinutes() / 60);
    return Math.max((dtt - 1 + hl / 6.25) / 365, 1 / 365);
  }
}
