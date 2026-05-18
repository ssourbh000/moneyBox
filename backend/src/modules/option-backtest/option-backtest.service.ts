import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OptionBacktestRun, OptionBacktestRunDocument, OBStatus } from './schemas/option-backtest-run.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { ema, rsi, OHLCV } from '../strategies/indicators';
import {
  bsPrice, itmStrike, calcVWAP, calcSupertrend, calcORB, calcCPR,
  istHHMM, istDayOfWeek, isNewDay,
} from '../strategies/option-indicators';

// ── Constants ─────────────────────────────────────────────────────────────────

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 25, tickSize: 50  },
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 15, tickSize: 100 },
] as const;

const RISK_FREE_RATE = 0.07;
const MAX_RISK_PER_TRADE = 4000;
const SL_PCT = 0.45;           // Stop at 45% of entry premium
const PARTIAL_MULT = 1.8;      // Book 50% lots at 1.8× premium
const ENTRY_FROM = 930;        // 9:30 AM IST
const ENTRY_TO = 1030;         // 10:30 AM IST
const EXIT_TIME = 1500;        // 3:00 PM IST
const VIX_MAX = 18;
const CPR_WIDTH_MAX_PCT = 0.5; // skip if CPR width > 0.5% of pivot (wide = sideways)
const RSI_BULL = 55;
const RSI_BEAR = 45;
const VOL_RATIO_MIN = 0.0; // volume filter disabled — 9:30-10:30 is already the highest-volume window
const ST_PERIOD = 10;
const ST_MULT = 3;
const EMA_FAST = 9;
const EMA_SLOW = 21;
const RSI_PERIOD = 14;
const VOL_LOOKBACK = 20;

// ── Trade interface ───────────────────────────────────────────────────────────

interface OBTrade {
  symbol: string;
  direction: 'CALL' | 'PUT';
  entryTime: string;
  exitTime: string;
  strike: number;
  entryPremium: number;
  exitPremium: number;
  lots: number;
  lotSize: number;
  grossPnl: number;
  netPnl: number;
  exitReason: 'SL' | 'TARGET' | 'TRAIL_SL' | 'EOD';
  vix: number;
  meta: Record<string, number | string>;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function mean(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stdDev(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function computeMetrics(trades: OBTrade[], initialCapital: number) {
  if (!trades.length) return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0, maxDrawdown: 0, sharpeRatio: 0, roi: 0, finalCapital: initialCapital };
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netPnl = grossProfit - grossLoss;
  let equity = initialCapital, peak = initialCapital, maxDD = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) {
    equity += t.netPnl;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  const dayPnl = new Map<string, number>();
  for (const t of trades) {
    const d = t.exitTime.slice(0, 10);
    dayPnl.set(d, (dayPnl.get(d) ?? 0) + t.netPnl);
  }
  const RFDR = 0.065 / 252;
  let runEq = initialCapital;
  const dailyRets: number[] = [];
  for (const [, pnl] of [...dayPnl.entries()].sort()) {
    dailyRets.push(pnl / runEq - RFDR);
    runEq += pnl;
  }
  const sharpe = dailyRets.length > 1 ? +(mean(dailyRets) / (stdDev(dailyRets) || 1e-10) * Math.sqrt(252)).toFixed(2) : 0;
  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: +((wins.length / trades.length) * 100).toFixed(1),
    netPnl: +netPnl.toFixed(2),
    grossProfit: +grossProfit.toFixed(2),
    grossLoss: +grossLoss.toFixed(2),
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : 99,
    avgWin: wins.length ? +(grossProfit / wins.length).toFixed(2) : 0,
    avgLoss: losses.length ? +(grossLoss / losses.length).toFixed(2) : 0,
    expectancy: +(netPnl / trades.length).toFixed(2),
    maxDrawdown: +maxDD.toFixed(2),
    sharpeRatio: sharpe,
    roi: +((netPnl / initialCapital) * 100).toFixed(2),
    finalCapital: +(initialCapital + netPnl).toFixed(2),
  };
}

// ── Open position state ───────────────────────────────────────────────────────

interface OpenOptionTrade {
  direction: 'CALL' | 'PUT';
  strike: number;
  entryPremium: number;
  entryTime: Date;
  slPremium: number;
  targetPremium: number;
  lots: number;
  partialBooked: boolean;
  trailSL: boolean;
  vix: number;
  meta: Record<string, number | string>;
}

// ── Main service ──────────────────────────────────────────────────────────────

@Injectable()
export class OptionBacktestService {
  private readonly logger = new Logger(OptionBacktestService.name);

  constructor(
    @InjectModel(OptionBacktestRun.name) private runModel: Model<OptionBacktestRunDocument>,
    private marketData: MarketDataService,
  ) {}

  async run(userId: string, fromDate: string, toDate: string): Promise<OptionBacktestRunDocument> {
    const record = await this.runModel.create({
      userId: new Types.ObjectId(userId),
      fromDate: new Date(fromDate),
      toDate: new Date(toDate),
      status: OBStatus.QUEUED,
    });
    void this.execute(record._id.toString(), fromDate, toDate);
    return record;
  }

  async get(id: string): Promise<OptionBacktestRunDocument | null> {
    return this.runModel.findById(id);
  }

  async list(userId: string): Promise<OptionBacktestRunDocument[]> {
    return this.runModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('-trades');
  }

  // ── Core simulation ─────────────────────────────────────────────────────────

  private async execute(runId: string, fromDate: string, toDate: string): Promise<void> {
    await this.runModel.findByIdAndUpdate(runId, { status: OBStatus.RUNNING });
    try {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      const allTrades: OBTrade[] = [];

      // Load VIX daily bars once
      const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
      const vixMap = new Map<string, number>();
      for (const v of vixBars) {
        vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);
      }

      for (const inst of INSTRUMENTS) {
        const trades = await this.simulateInstrument(inst, from, to, vixMap);
        allTrades.push(...trades);
        this.logger.log(`${inst.symbol}: ${trades.length} trades`);
      }

      allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));

      // Equity curve
      let equity = 1_000_000;
      const equityCurve: { t: string; e: number }[] = [];
      for (const t of [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) {
        equity += t.netPnl;
        equityCurve.push({ t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) });
      }

      const metrics = { ...computeMetrics(allTrades, 1_000_000), equityCurve };

      await this.runModel.findByIdAndUpdate(runId, {
        status: OBStatus.COMPLETED,
        metrics,
        trades: allTrades,
      });
    } catch (err: any) {
      this.logger.error(`OptionBacktest ${runId} failed: ${err.message}`);
      await this.runModel.findByIdAndUpdate(runId, { status: OBStatus.FAILED, errorMessage: err.message });
    }
  }

  private async simulateInstrument(
    inst: typeof INSTRUMENTS[number],
    from: Date,
    to: Date,
    vixMap: Map<string, number>,
  ): Promise<OBTrade[]> {
    // Load 1 month of extra lookback for indicator warmup
    const lookback = new Date(from);
    lookback.setMonth(lookback.getMonth() - 1);

    const [bars5, dayBars] = await Promise.all([
      this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookback, to),
      this.marketData.getCandles(inst.symbol, inst.exchange, 'day', lookback, to),
    ]);

    if (bars5.length < 50) return [];

    const trades: OBTrade[] = [];
    let sessionBars: OHLCV[] = [];   // resets each day — used for VWAP + ORB only
    const rollingBars: OHLCV[] = []; // cross-day window — used for EMA / RSI / Supertrend
    const ROLLING_MAX = 200;
    let orbHigh = 0, orbLow = 0;
    let orbSet = false;
    let openTrade: OpenOptionTrade | null = null;
    let prevBar: typeof bars5[0] | null = null;

    for (let i = 0; i < bars5.length; i++) {
      const bar = bars5[i];
      const barDate = bar.timestamp;
      const hhmm = istHHMM(barDate);
      const dayOfWeek = istDayOfWeek(barDate);
      const ohlcv: OHLCV = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };

      // ── New day reset ──────────────────────────────────────────────────────
      if (!prevBar || isNewDay(prevBar.timestamp, barDate)) {
        if (openTrade && prevBar) {
          const T = this.timeToWeeklyExpiry(prevBar.timestamp);
          const exitP = bsPrice(prevBar.close, openTrade.strike, RISK_FREE_RATE, T, 0.15, openTrade.direction === 'CALL' ? 'call' : 'put');
          trades.push(this.makeTrade(inst, openTrade, exitP, prevBar.timestamp, 'EOD'));
          openTrade = null;
        }
        sessionBars = [];
        orbSet = false;
        orbHigh = 0;
        orbLow = 0;
      }
      prevBar = bar;

      // Always push to rolling window
      rollingBars.push(ohlcv);
      if (rollingBars.length > ROLLING_MAX) rollingBars.shift();

      // Warmup: accumulate bars before from date without trading
      if (barDate < from) {
        sessionBars.push(ohlcv);
        continue;
      }

      // Skip weekends and Fridays
      if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) continue;

      const dateKey = barDate.toISOString().slice(0, 10);
      const vix = vixMap.get(dateKey) ?? 15;
      if (vix > VIX_MAX) { sessionBars.push(ohlcv); continue; }

      sessionBars.push(ohlcv);

      // ── Set ORB after first 3 session bars (9:15, 9:20, 9:25 → fires at 9:30) ──
      if (!orbSet && sessionBars.length >= 3 && hhmm >= 930) {
        const orb = calcORB(sessionBars, 3);
        orbHigh = orb.high;
        orbLow = orb.low;
        orbSet = true;
        const prevDayBar = this.findPrevDayBar(dayBars, barDate);
        if (prevDayBar) {
          const cpr = calcCPR({ open: prevDayBar.open, high: prevDayBar.high, low: prevDayBar.low, close: prevDayBar.close, volume: prevDayBar.volume });
          if (cpr.widthPct > CPR_WIDTH_MAX_PCT) orbSet = false; // wide CPR → skip day
        }
      }

      // ── Manage open trade ──────────────────────────────────────────────────
      if (openTrade) {
        const T = this.timeToWeeklyExpiry(barDate);
        const currPrem = bsPrice(bar.close, openTrade.strike, RISK_FREE_RATE, T, vix / 100, openTrade.direction === 'CALL' ? 'call' : 'put');
        if (!openTrade.partialBooked && currPrem >= openTrade.entryPremium * PARTIAL_MULT) {
          openTrade.partialBooked = true;
          openTrade.trailSL = true;
          openTrade.slPremium = openTrade.entryPremium;
          openTrade.lots = Math.max(1, Math.floor(openTrade.lots / 2));
        }
        if (currPrem <= openTrade.slPremium) {
          trades.push(this.makeTrade(inst, openTrade, openTrade.slPremium, barDate, openTrade.trailSL ? 'TRAIL_SL' : 'SL'));
          openTrade = null;
        } else if (hhmm >= EXIT_TIME) {
          trades.push(this.makeTrade(inst, openTrade, currPrem, barDate, 'EOD'));
          openTrade = null;
        }
        continue;
      }

      // ── Entry logic ────────────────────────────────────────────────────────
      if (!orbSet || hhmm < ENTRY_FROM || hhmm > ENTRY_TO) continue;
      // Need enough bars in rolling window for indicators
      if (rollingBars.length < Math.max(EMA_SLOW, RSI_PERIOD, ST_PERIOD * 2) + 5) continue;

      // Trend indicators use rolling window (cross-day)
      const rCloses = rollingBars.map((b) => b.close);
      const rVols   = rollingBars.map((b) => b.volume);
      const emaFast = ema(rCloses, EMA_FAST);
      const emaSlow = ema(rCloses, EMA_SLOW);
      const rsiVals = rsi(rCloses, RSI_PERIOD);
      const st      = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT);

      // VWAP uses session bars only
      const vwap    = calcVWAP(sessionBars);

      const ef       = emaFast[emaFast.length - 1];
      const es       = emaSlow[emaSlow.length - 1];
      const rsiVal   = rsiVals[rsiVals.length - 1];
      const vwapVal  = vwap[vwap.length - 1];
      const trendNow  = st.trend[st.trend.length - 1];
      const trendPrev = st.trend[st.trend.length - 2];

      if (!ef || !es || !rsiVal || !vwapVal || trendNow === 0) continue;

      // Use session volume avg so morning bars aren't penalised by afternoon baseline
      const sessionVols = sessionBars.map((b) => b.volume);
      const avgVol = sessionVols.length > 1
        ? sessionVols.slice(0, -1).reduce((a, b) => a + b, 0) / (sessionVols.length - 1)
        : rVols.slice(-VOL_LOOKBACK - 1, -1).reduce((a, b) => a + b, 0) / VOL_LOOKBACK;
      const volRatio = avgVol > 0 ? ohlcv.volume / avgVol : 0;

      // Supertrend flip check
      const bullFlip = trendPrev !== 1 && trendNow === 1;
      const bearFlip = trendPrev !== -1 && trendNow === -1;

      // CALL setup
      const callSignal =
        bullFlip &&
        bar.close > orbHigh &&
        bar.close > vwapVal &&
        ef > es &&
        rsiVal > RSI_BULL &&
        volRatio >= VOL_RATIO_MIN;

      // PUT setup
      const putSignal =
        bearFlip &&
        bar.close < orbLow &&
        bar.close < vwapVal &&
        ef < es &&
        rsiVal < RSI_BEAR &&
        volRatio >= VOL_RATIO_MIN;

      if (!callSignal && !putSignal) continue;

      const direction: 'CALL' | 'PUT' = callSignal ? 'CALL' : 'PUT';
      const strike = itmStrike(bar.close, direction, inst.tickSize);
      const T = this.timeToWeeklyExpiry(barDate);
      const entryPrem = bsPrice(bar.close, strike, RISK_FREE_RATE, T, vix / 100, direction === 'CALL' ? 'call' : 'put');

      if (entryPrem < 10) continue; // too cheap — ignore

      const slPrem = +(entryPrem * SL_PCT).toFixed(2);
      const riskPerLot = (entryPrem - slPrem) * inst.lotSize;
      const lots = Math.max(1, Math.floor(MAX_RISK_PER_TRADE / riskPerLot));

      openTrade = {
        direction,
        strike,
        entryPremium: +entryPrem.toFixed(2),
        entryTime: barDate,
        slPremium: slPrem,
        targetPremium: +(entryPrem * 2.5).toFixed(2),
        lots,
        partialBooked: false,
        trailSL: false,
        vix,
        meta: {
          orbHigh: +orbHigh.toFixed(2),
          orbLow: +orbLow.toFixed(2),
          vwap: +vwapVal.toFixed(2),
          ema9: +ef.toFixed(2),
          ema21: +es.toFixed(2),
          rsi: +rsiVal.toFixed(1),
          volRatio: +volRatio.toFixed(2),
        },
      };
    }

    return trades;
  }

  private makeTrade(
    inst: typeof INSTRUMENTS[number],
    t: OpenOptionTrade,
    exitPrem: number,
    exitTime: Date,
    reason: OBTrade['exitReason'],
  ): OBTrade {
    const grossPnl = (exitPrem - t.entryPremium) * t.lots * inst.lotSize;
    const costs = 40 * t.lots; // ~₹20 brokerage each side
    return {
      symbol: inst.symbol,
      direction: t.direction,
      entryTime: t.entryTime.toISOString(),
      exitTime: exitTime.toISOString(),
      strike: t.strike,
      entryPremium: t.entryPremium,
      exitPremium: +exitPrem.toFixed(2),
      lots: t.lots,
      lotSize: inst.lotSize,
      grossPnl: +grossPnl.toFixed(2),
      netPnl: +(grossPnl - costs).toFixed(2),
      exitReason: reason,
      vix: t.vix,
      meta: t.meta,
    };
  }

  private findPrevDayBar(dayBars: any[], date: Date) {
    const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    const today = ist.toISOString().slice(0, 10);
    for (let i = dayBars.length - 1; i >= 0; i--) {
      const d = new Date(dayBars[i].timestamp.getTime() + 5.5 * 60 * 60 * 1000);
      if (d.toISOString().slice(0, 10) < today) return dayBars[i];
    }
    return null;
  }

  // Approximate days to next Thursday (weekly expiry)
  private timeToWeeklyExpiry(date: Date): number {
    const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    const dow = ist.getUTCDay(); // 0=Sun, 4=Thu
    const daysToThursday = ((4 - dow + 7) % 7) || 7;
    const hoursLeft = 15.5 - (ist.getUTCHours() + ist.getUTCMinutes() / 60); // hours left in session
    return Math.max((daysToThursday - 1 + hoursLeft / 6.25) / 365, 1 / 365);
  }
}
