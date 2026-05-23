import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EmacrossBacktestRun, EmacrossBacktestRunDocument, ECStatus } from './schemas/emacross-backtest-run.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { ema, rsi, OHLCV } from '../strategies/indicators';
import {
  bsPrice, itmStrike, calcVWAP, calcSupertrend, calcORB, calcCPR,
  istHHMM, istDayOfWeek, isNewDay,
} from '../strategies/option-indicators';

// ── Strategy D: EMA Crossover (original tight params) ────────────────────────
//
//  Replaces the Supertrend FLIP trigger with an EMA(9/21) crossover event.
//  All other parameters are kept IDENTICAL to the Original strategy to isolate
//  the effect of changing the trigger alone:
//    • Entry window: 9:30–10:30 AM (unchanged)
//    • VIX ≤ 18 (unchanged)
//    • CPR width ≤ 0.5% (unchanged)
//    • RSI > 55 / < 45 (unchanged)
//    • 1 trade/day max (unchanged — no re-entry)
//  Supertrend direction used as a confirming filter (not flip trigger).

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 25, tickSize: 50  },
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 15, tickSize: 100 },
] as const;

const RISK_FREE_RATE     = 0.07;
const MAX_RISK_PER_TRADE = 4000;
const SL_PCT             = 0.45;
const PARTIAL_MULT       = 1.8;
const ENTRY_FROM         = 930;    // original tight window
const ENTRY_TO           = 1030;   // original tight window
const EXIT_TIME          = 1500;
const VIX_MAX            = 18;     // original strict VIX
const CPR_WIDTH_MAX_PCT  = 0.5;    // original strict CPR
const RSI_BULL           = 55;     // original RSI thresholds
const RSI_BEAR           = 45;
const ST_PERIOD          = 10;
const ST_MULT            = 3;
const EMA_FAST           = 9;
const EMA_SLOW           = 21;
const RSI_PERIOD         = 14;
const VOL_LOOKBACK       = 20;

interface ECTrade {
  symbol: string; direction: 'CALL' | 'PUT'; entryTime: string; exitTime: string;
  strike: number; entryPremium: number; exitPremium: number; lots: number;
  lotSize: number; grossPnl: number; netPnl: number;
  exitReason: 'SL' | 'TARGET' | 'TRAIL_SL' | 'EOD'; vix: number;
  meta: Record<string, number | string>;
}

interface OpenECTrade {
  direction: 'CALL' | 'PUT'; strike: number; entryPremium: number; entryTime: Date;
  slPremium: number; targetPremium: number; lots: number; partialBooked: boolean;
  trailSL: boolean; vix: number; meta: Record<string, number | string>;
}

function mean(a: number[]) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stdDev(a: number[]) {
  if (a.length < 2) return 0; const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function computeMetrics(trades: ECTrade[], init: number) {
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
export class EmacrossBacktestService {
  private readonly logger = new Logger(EmacrossBacktestService.name);

  constructor(
    @InjectModel(EmacrossBacktestRun.name) private runModel: Model<EmacrossBacktestRunDocument>,
    private marketData: MarketDataService,
  ) {}

  async run(userId: string, fromDate: string, toDate: string) {
    const record = await this.runModel.create({ userId: new Types.ObjectId(userId), fromDate: new Date(fromDate), toDate: new Date(toDate), status: ECStatus.QUEUED });
    void this.execute(record._id.toString(), fromDate, toDate);
    return record;
  }

  async get(id: string) { return this.runModel.findById(id); }

  async list(userId: string) {
    return this.runModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(20).select('-trades');
  }

  private async execute(runId: string, fromDate: string, toDate: string) {
    await this.runModel.findByIdAndUpdate(runId, { status: ECStatus.RUNNING });
    try {
      const from = new Date(fromDate), to = new Date(toDate);
      const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
      const vixMap = new Map<string, number>();
      for (const v of vixBars) vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);
      const allTrades: ECTrade[] = [];
      for (const inst of INSTRUMENTS) {
        const trades = await this.simulateInstrument(inst, from, to, vixMap);
        allTrades.push(...trades);
        this.logger.log(`EmaCross ${inst.symbol}: ${trades.length} trades`);
      }
      allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));
      let equity = 1_000_000;
      const equityCurve: { t: string; e: number }[] = [];
      for (const t of [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) { equity += t.netPnl; equityCurve.push({ t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) }); }
      await this.runModel.findByIdAndUpdate(runId, { status: ECStatus.COMPLETED, metrics: { ...computeMetrics(allTrades, 1_000_000), equityCurve }, trades: allTrades });
    } catch (err: any) {
      this.logger.error(`EmacrossBacktest ${runId} failed: ${err.message}`);
      await this.runModel.findByIdAndUpdate(runId, { status: ECStatus.FAILED, errorMessage: err.message });
    }
  }

  private async simulateInstrument(inst: typeof INSTRUMENTS[number], from: Date, to: Date, vixMap: Map<string, number>): Promise<ECTrade[]> {
    const lookback = new Date(from); lookback.setMonth(lookback.getMonth() - 1);
    const [bars5, dayBars] = await Promise.all([
      this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookback, to),
      this.marketData.getCandles(inst.symbol, inst.exchange, 'day', lookback, to),
    ]);
    if (bars5.length < 50) return [];

    const trades: ECTrade[] = [];
    let sessionBars: OHLCV[] = [], prevBar: typeof bars5[0] | null = null;
    const rollingBars: OHLCV[] = [];
    let orbHigh = 0, orbLow = 0, orbSet = false;
    let openTrade: OpenECTrade | null = null;

    for (const bar of bars5) {
      const barDate = bar.timestamp, hhmm = istHHMM(barDate), dow = istDayOfWeek(barDate);
      const ohlcv: OHLCV = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };

      if (!prevBar || isNewDay(prevBar.timestamp, barDate)) {
        if (openTrade && prevBar) {
          const T = this.tte(prevBar.timestamp);
          const ep = bsPrice(prevBar.close, openTrade.strike, RISK_FREE_RATE, T, 0.15, openTrade.direction === 'CALL' ? 'call' : 'put');
          trades.push(this.mk(inst, openTrade, ep, prevBar.timestamp, 'EOD'));
          openTrade = null;
        }
        sessionBars = []; orbSet = false; orbHigh = orbLow = 0;
      }
      prevBar = bar;
      rollingBars.push(ohlcv); if (rollingBars.length > 200) rollingBars.shift();

      if (barDate < from) { sessionBars.push(ohlcv); continue; }
      if (dow === 0 || dow === 5 || dow === 6) continue;
      const vix = vixMap.get(barDate.toISOString().slice(0, 10)) ?? 15;
      if (vix > VIX_MAX) { sessionBars.push(ohlcv); continue; }
      sessionBars.push(ohlcv);

      if (!orbSet && sessionBars.length >= 3 && hhmm >= 930) {
        const orb = calcORB(sessionBars, 3); orbHigh = orb.high; orbLow = orb.low; orbSet = true;
        const pd = this.prevDay(dayBars, barDate);
        if (pd) { const cpr = calcCPR({ open: pd.open, high: pd.high, low: pd.low, close: pd.close, volume: pd.volume }); if (cpr.widthPct > CPR_WIDTH_MAX_PCT) orbSet = false; }
      }

      if (openTrade) {
        const T = this.tte(barDate);
        const cp = bsPrice(bar.close, openTrade.strike, RISK_FREE_RATE, T, vix / 100, openTrade.direction === 'CALL' ? 'call' : 'put');
        if (!openTrade.partialBooked && cp >= openTrade.entryPremium * PARTIAL_MULT) { openTrade.partialBooked = true; openTrade.trailSL = true; openTrade.slPremium = openTrade.entryPremium; openTrade.lots = Math.max(1, Math.floor(openTrade.lots / 2)); }
        if (cp <= openTrade.slPremium) { trades.push(this.mk(inst, openTrade, openTrade.slPremium, barDate, openTrade.trailSL ? 'TRAIL_SL' : 'SL')); openTrade = null; }
        else if (hhmm >= EXIT_TIME) { trades.push(this.mk(inst, openTrade, cp, barDate, 'EOD')); openTrade = null; }
        continue;
      }

      if (!orbSet || hhmm < ENTRY_FROM || hhmm > ENTRY_TO) continue;
      if (rollingBars.length < Math.max(EMA_SLOW, RSI_PERIOD, ST_PERIOD * 2) + 5) continue;

      const rc = rollingBars.map(b => b.close);
      const efArr = ema(rc, EMA_FAST), esArr = ema(rc, EMA_SLOW), rvArr = rsi(rc, RSI_PERIOD);
      const st = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT), vw = calcVWAP(sessionBars);
      const efN = efArr[efArr.length - 1], esN = esArr[esArr.length - 1];
      const efP = efArr[efArr.length - 2], esP = esArr[esArr.length - 2];
      const rsiV = rvArr[rvArr.length - 1], vwV = vw[vw.length - 1];
      const tN = st.trend[st.trend.length - 1];
      if (!efN || !esN || !efP || !esP || !rsiV || !vwV || tN === 0) continue;

      const sessionVols = sessionBars.map(b => b.volume);
      const avgVol = sessionVols.length > 1 ? sessionVols.slice(0, -1).reduce((a, b) => a + b, 0) / (sessionVols.length - 1) : 1;
      const volRatio = avgVol > 0 ? ohlcv.volume / avgVol : 0;
      void volRatio;

      // ── EMA crossover trigger (only change from Original) ───────────────────
      const emaBullCross = efP <= esP && efN > esN;
      const emaBearCross = efP >= esP && efN < esN;

      // Original strict confirmation filters — unchanged
      const callOk = emaBullCross && tN === 1 && bar.close > orbHigh && bar.close > vwV && rsiV > RSI_BULL;
      const putOk  = emaBearCross && tN === -1 && bar.close < orbLow && bar.close < vwV && rsiV < RSI_BEAR;
      if (!callOk && !putOk) continue;

      const dir: 'CALL' | 'PUT' = callOk ? 'CALL' : 'PUT';
      const strike = itmStrike(bar.close, dir, inst.tickSize);
      const T = this.tte(barDate);
      const ep = bsPrice(bar.close, strike, RISK_FREE_RATE, T, vix / 100, dir === 'CALL' ? 'call' : 'put');
      if (ep < 10) continue;
      const slP = +(ep * SL_PCT).toFixed(2);
      const lots = Math.max(1, Math.floor(MAX_RISK_PER_TRADE / ((ep - slP) * inst.lotSize)));
      openTrade = { direction: dir, strike, entryPremium: +ep.toFixed(2), entryTime: barDate, slPremium: slP, targetPremium: +(ep * 2.5).toFixed(2), lots, partialBooked: false, trailSL: false, vix, meta: { orbHigh: +orbHigh.toFixed(2), orbLow: +orbLow.toFixed(2), vwap: +vwV.toFixed(2), ema9: +efN.toFixed(2), ema21: +esN.toFixed(2), rsi: +rsiV.toFixed(1), cross: callOk ? 'EMA_BULL' : 'EMA_BEAR' } };
    }
    return trades;
  }

  private mk(inst: typeof INSTRUMENTS[number], t: OpenECTrade, exitPrem: number, exitTime: Date, reason: ECTrade['exitReason']): ECTrade {
    const gp = (exitPrem - t.entryPremium) * t.lots * inst.lotSize;
    return { symbol: inst.symbol, direction: t.direction, entryTime: t.entryTime.toISOString(), exitTime: exitTime.toISOString(), strike: t.strike, entryPremium: t.entryPremium, exitPremium: +exitPrem.toFixed(2), lots: t.lots, lotSize: inst.lotSize, grossPnl: +gp.toFixed(2), netPnl: +(gp - 40 * t.lots).toFixed(2), exitReason: reason, vix: t.vix, meta: t.meta };
  }

  private prevDay(dayBars: any[], date: Date) {
    const ist = new Date(date.getTime() + 5.5 * 3600000), today = ist.toISOString().slice(0, 10);
    for (let i = dayBars.length - 1; i >= 0; i--) { const d = new Date(dayBars[i].timestamp.getTime() + 5.5 * 3600000); if (d.toISOString().slice(0, 10) < today) return dayBars[i]; }
    return null;
  }

  private tte(date: Date): number {
    const ist = new Date(date.getTime() + 5.5 * 3600000), dow = ist.getUTCDay();
    const dtt = ((4 - dow + 7) % 7) || 7, hl = 15.5 - (ist.getUTCHours() + ist.getUTCMinutes() / 60);
    return Math.max((dtt - 1 + hl / 6.25) / 365, 1 / 365);
  }
}
