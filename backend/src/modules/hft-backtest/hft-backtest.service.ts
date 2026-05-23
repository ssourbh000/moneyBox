import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HftBacktestRun, HftBacktestRunDocument, HBStatus } from './schemas/hft-backtest-run.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { ema, rsi, OHLCV } from '../strategies/indicators';
import {
  bsPrice, itmStrike, calcVWAP, calcSupertrend, calcORB, calcCPR,
  istHHMM, istDayOfWeek, isNewDay,
} from '../strategies/option-indicators';

// ── Strategy: Option D + A ─────────────────────────────────────────────────────
//
//  Changes vs original ORB+Supertrend strategy:
//  1. Entry trigger  → EMA(9/21) crossover event (not Supertrend flip)
//  2. Supertrend     → direction filter only (confirms trend, not flip)
//  3. Entry window   → 9:30 AM – 2:00 PM (was 9:30–10:30)
//  4. VIX ceiling    → 20 (was 18)
//  5. CPR filter     → 1.0% width (was 0.5%)
//  6. RSI thresholds → 52 bull / 48 bear (was 55/45)
//  7. Max 2 trades/day with 25-min cooldown after each exit

// ── Constants ─────────────────────────────────────────────────────────────────

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 25, tickSize: 50  },
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 15, tickSize: 100 },
] as const;

const RISK_FREE_RATE      = 0.07;
const MAX_RISK_PER_TRADE  = 4000;
const SL_PCT              = 0.45;
const PARTIAL_MULT        = 1.8;
const ENTRY_FROM          = 930;
const ENTRY_TO            = 1400;   // extended: was 1030
const EXIT_TIME           = 1500;
const VIX_MAX             = 20;     // relaxed: was 18
const CPR_WIDTH_MAX_PCT   = 1.0;    // relaxed: was 0.5
const RSI_BULL            = 52;     // relaxed: was 55
const RSI_BEAR            = 48;     // relaxed: was 45
const MAX_TRADES_PER_DAY  = 2;
const COOLDOWN_MS         = 25 * 60 * 1000; // 25 min between trades
const ST_PERIOD           = 10;
const ST_MULT             = 3;
const EMA_FAST            = 9;
const EMA_SLOW            = 21;
const RSI_PERIOD          = 14;
const VOL_LOOKBACK        = 20;

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface HBTrade {
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

interface OpenHBTrade {
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

// ── Metrics ────────────────────────────────────────────────────────────────────

function mean(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stdDev(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function computeMetrics(trades: HBTrade[], initialCapital: number) {
  if (!trades.length) return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0, maxDrawdown: 0, sharpeRatio: 0, roi: 0, finalCapital: initialCapital };
  const wins   = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netPnl      = grossProfit - grossLoss;
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
  const sharpe = dailyRets.length > 1
    ? +(mean(dailyRets) / (stdDev(dailyRets) || 1e-10) * Math.sqrt(252)).toFixed(2)
    : 0;
  return {
    totalTrades:  trades.length,
    wins:         wins.length,
    losses:       losses.length,
    winRate:      +((wins.length / trades.length) * 100).toFixed(1),
    netPnl:       +netPnl.toFixed(2),
    grossProfit:  +grossProfit.toFixed(2),
    grossLoss:    +grossLoss.toFixed(2),
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : 99,
    avgWin:       wins.length   ? +(grossProfit / wins.length).toFixed(2)   : 0,
    avgLoss:      losses.length ? +(grossLoss   / losses.length).toFixed(2) : 0,
    expectancy:   +(netPnl / trades.length).toFixed(2),
    maxDrawdown:  +maxDD.toFixed(2),
    sharpeRatio:  sharpe,
    roi:          +((netPnl / initialCapital) * 100).toFixed(2),
    finalCapital: +(initialCapital + netPnl).toFixed(2),
  };
}

// ── Main service ───────────────────────────────────────────────────────────────

@Injectable()
export class HftBacktestService {
  private readonly logger = new Logger(HftBacktestService.name);

  constructor(
    @InjectModel(HftBacktestRun.name) private runModel: Model<HftBacktestRunDocument>,
    private marketData: MarketDataService,
  ) {}

  async run(userId: string, fromDate: string, toDate: string): Promise<HftBacktestRunDocument> {
    const record = await this.runModel.create({
      userId: new Types.ObjectId(userId),
      fromDate: new Date(fromDate),
      toDate: new Date(toDate),
      status: HBStatus.QUEUED,
    });
    void this.execute(record._id.toString(), fromDate, toDate);
    return record;
  }

  async get(id: string): Promise<HftBacktestRunDocument | null> {
    return this.runModel.findById(id);
  }

  async list(userId: string): Promise<HftBacktestRunDocument[]> {
    return this.runModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('-trades');
  }

  // ── Core simulation ──────────────────────────────────────────────────────────

  private async execute(runId: string, fromDate: string, toDate: string): Promise<void> {
    await this.runModel.findByIdAndUpdate(runId, { status: HBStatus.RUNNING });
    try {
      const from = new Date(fromDate);
      const to   = new Date(toDate);
      const allTrades: HBTrade[] = [];

      const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
      const vixMap  = new Map<string, number>();
      for (const v of vixBars) vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);

      for (const inst of INSTRUMENTS) {
        const trades = await this.simulateInstrument(inst, from, to, vixMap);
        allTrades.push(...trades);
        this.logger.log(`HFT ${inst.symbol}: ${trades.length} trades`);
      }

      allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));

      let equity = 1_000_000;
      const equityCurve: { t: string; e: number }[] = [];
      for (const t of [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) {
        equity += t.netPnl;
        equityCurve.push({ t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) });
      }

      const metrics = { ...computeMetrics(allTrades, 1_000_000), equityCurve };

      await this.runModel.findByIdAndUpdate(runId, {
        status: HBStatus.COMPLETED,
        metrics,
        trades: allTrades,
      });
    } catch (err: any) {
      this.logger.error(`HftBacktest ${runId} failed: ${err.message}`);
      await this.runModel.findByIdAndUpdate(runId, { status: HBStatus.FAILED, errorMessage: err.message });
    }
  }

  private async simulateInstrument(
    inst: typeof INSTRUMENTS[number],
    from: Date,
    to: Date,
    vixMap: Map<string, number>,
  ): Promise<HBTrade[]> {
    const lookback = new Date(from);
    lookback.setMonth(lookback.getMonth() - 1);

    const [bars5, dayBars] = await Promise.all([
      this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookback, to),
      this.marketData.getCandles(inst.symbol, inst.exchange, 'day', lookback, to),
    ]);

    if (bars5.length < 50) return [];

    const trades: HBTrade[]    = [];
    let sessionBars: OHLCV[]   = [];
    const rollingBars: OHLCV[] = [];
    const ROLLING_MAX          = 200;

    let orbHigh = 0, orbLow = 0, orbSet = false;
    let openTrade: OpenHBTrade | null = null;
    let prevBar: typeof bars5[0] | null = null;

    // Day-level state for re-entry management
    let tradesOpenedToday  = 0;
    let lastTradeExitTime: Date | null = null;

    for (let i = 0; i < bars5.length; i++) {
      const bar       = bars5[i];
      const barDate   = bar.timestamp;
      const hhmm      = istHHMM(barDate);
      const dayOfWeek = istDayOfWeek(barDate);
      const ohlcv: OHLCV = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };

      // ── New day reset ────────────────────────────────────────────────────────
      if (!prevBar || isNewDay(prevBar.timestamp, barDate)) {
        if (openTrade && prevBar) {
          const T      = this.timeToWeeklyExpiry(prevBar.timestamp);
          const exitP  = bsPrice(prevBar.close, openTrade.strike, RISK_FREE_RATE, T, 0.15, openTrade.direction === 'CALL' ? 'call' : 'put');
          trades.push(this.makeTrade(inst, openTrade, exitP, prevBar.timestamp, 'EOD'));
          lastTradeExitTime = prevBar.timestamp;
          openTrade = null;
        }
        sessionBars      = [];
        orbSet           = false;
        orbHigh          = 0;
        orbLow           = 0;
        tradesOpenedToday  = 0;
        lastTradeExitTime  = null;
      }
      prevBar = bar;

      rollingBars.push(ohlcv);
      if (rollingBars.length > ROLLING_MAX) rollingBars.shift();

      if (barDate < from) {
        sessionBars.push(ohlcv);
        continue;
      }

      // Skip weekends and Fridays
      if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) continue;

      const dateKey = barDate.toISOString().slice(0, 10);
      const vix     = vixMap.get(dateKey) ?? 15;
      if (vix > VIX_MAX) { sessionBars.push(ohlcv); continue; }

      sessionBars.push(ohlcv);

      // ── Set ORB after first 3 session bars ──────────────────────────────────
      if (!orbSet && sessionBars.length >= 3 && hhmm >= 930) {
        const orb = calcORB(sessionBars, 3);
        orbHigh = orb.high;
        orbLow  = orb.low;
        orbSet  = true;
        const prevDayBar = this.findPrevDayBar(dayBars, barDate);
        if (prevDayBar) {
          const cpr = calcCPR({ open: prevDayBar.open, high: prevDayBar.high, low: prevDayBar.low, close: prevDayBar.close, volume: prevDayBar.volume });
          if (cpr.widthPct > CPR_WIDTH_MAX_PCT) orbSet = false;
        }
      }

      // ── Manage open trade ────────────────────────────────────────────────────
      if (openTrade) {
        const T        = this.timeToWeeklyExpiry(barDate);
        const currPrem = bsPrice(bar.close, openTrade.strike, RISK_FREE_RATE, T, vix / 100, openTrade.direction === 'CALL' ? 'call' : 'put');

        if (!openTrade.partialBooked && currPrem >= openTrade.entryPremium * PARTIAL_MULT) {
          openTrade.partialBooked = true;
          openTrade.trailSL       = true;
          openTrade.slPremium     = openTrade.entryPremium;
          openTrade.lots          = Math.max(1, Math.floor(openTrade.lots / 2));
        }

        if (currPrem <= openTrade.slPremium) {
          trades.push(this.makeTrade(inst, openTrade, openTrade.slPremium, barDate, openTrade.trailSL ? 'TRAIL_SL' : 'SL'));
          lastTradeExitTime = barDate;
          openTrade = null;
        } else if (hhmm >= EXIT_TIME) {
          trades.push(this.makeTrade(inst, openTrade, currPrem, barDate, 'EOD'));
          lastTradeExitTime = barDate;
          openTrade = null;
        }
        continue;
      }

      // ── Entry gate checks ────────────────────────────────────────────────────
      if (!orbSet || hhmm < ENTRY_FROM || hhmm > ENTRY_TO) continue;
      if (tradesOpenedToday >= MAX_TRADES_PER_DAY) continue;
      if (lastTradeExitTime && barDate.getTime() - lastTradeExitTime.getTime() < COOLDOWN_MS) continue;
      if (rollingBars.length < Math.max(EMA_SLOW, RSI_PERIOD, ST_PERIOD * 2) + 5) continue;

      // ── Indicators ───────────────────────────────────────────────────────────
      const rCloses = rollingBars.map((b) => b.close);
      const rVols   = rollingBars.map((b) => b.volume);
      const emaFast = ema(rCloses, EMA_FAST);
      const emaSlow = ema(rCloses, EMA_SLOW);
      const rsiVals = rsi(rCloses, RSI_PERIOD);
      const st      = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT);
      const vwap    = calcVWAP(sessionBars);

      const ef     = emaFast[emaFast.length - 1];
      const es     = emaSlow[emaSlow.length - 1];
      const efPrev = emaFast[emaFast.length - 2];
      const esPrev = emaSlow[emaSlow.length - 2];
      const rsiVal  = rsiVals[rsiVals.length - 1];
      const vwapVal = vwap[vwap.length - 1];
      const trendNow = st.trend[st.trend.length - 1];

      if (!ef || !es || !efPrev || !esPrev || !rsiVal || !vwapVal || trendNow === 0) continue;

      // Volume ratio (session-relative)
      const sessionVols = sessionBars.map((b) => b.volume);
      const avgVol = sessionVols.length > 1
        ? sessionVols.slice(0, -1).reduce((a, b) => a + b, 0) / (sessionVols.length - 1)
        : rVols.slice(-VOL_LOOKBACK - 1, -1).reduce((a, b) => a + b, 0) / VOL_LOOKBACK;
      const volRatio = avgVol > 0 ? ohlcv.volume / avgVol : 0;

      // EMA crossover events (Option D core change)
      const emaBullCross = efPrev <= esPrev && ef > es;
      const emaBearCross = efPrev >= esPrev && ef < es;

      // CALL: EMA bull cross + Supertrend bullish + ORB break above + VWAP above + RSI momentum
      const callSignal =
        emaBullCross &&
        trendNow === 1 &&
        bar.close > orbHigh &&
        bar.close > vwapVal &&
        rsiVal > RSI_BULL;

      // PUT: EMA bear cross + Supertrend bearish + ORB break below + VWAP below + RSI momentum
      const putSignal =
        emaBearCross &&
        trendNow === -1 &&
        bar.close < orbLow &&
        bar.close < vwapVal &&
        rsiVal < RSI_BEAR;

      if (!callSignal && !putSignal) continue;

      const direction: 'CALL' | 'PUT' = callSignal ? 'CALL' : 'PUT';
      const strike    = itmStrike(bar.close, direction, inst.tickSize);
      const T         = this.timeToWeeklyExpiry(barDate);
      const entryPrem = bsPrice(bar.close, strike, RISK_FREE_RATE, T, vix / 100, direction === 'CALL' ? 'call' : 'put');

      if (entryPrem < 10) continue;

      const slPrem     = +(entryPrem * SL_PCT).toFixed(2);
      const riskPerLot = (entryPrem - slPrem) * inst.lotSize;
      const lots       = Math.max(1, Math.floor(MAX_RISK_PER_TRADE / riskPerLot));

      tradesOpenedToday++;
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
          orbHigh:   +orbHigh.toFixed(2),
          orbLow:    +orbLow.toFixed(2),
          vwap:      +vwapVal.toFixed(2),
          ema9:      +ef.toFixed(2),
          ema21:     +es.toFixed(2),
          rsi:       +rsiVal.toFixed(1),
          volRatio:  +volRatio.toFixed(2),
          tradeNo:   tradesOpenedToday,
          cross:     callSignal ? 'EMA_BULL' : 'EMA_BEAR',
        },
      };
    }

    return trades;
  }

  private makeTrade(
    inst: typeof INSTRUMENTS[number],
    t: OpenHBTrade,
    exitPrem: number,
    exitTime: Date,
    reason: HBTrade['exitReason'],
  ): HBTrade {
    const grossPnl = (exitPrem - t.entryPremium) * t.lots * inst.lotSize;
    const costs    = 40 * t.lots;
    return {
      symbol:        inst.symbol,
      direction:     t.direction,
      entryTime:     t.entryTime.toISOString(),
      exitTime:      exitTime.toISOString(),
      strike:        t.strike,
      entryPremium:  t.entryPremium,
      exitPremium:   +exitPrem.toFixed(2),
      lots:          t.lots,
      lotSize:       inst.lotSize,
      grossPnl:      +grossPnl.toFixed(2),
      netPnl:        +(grossPnl - costs).toFixed(2),
      exitReason:    reason,
      vix:           t.vix,
      meta:          t.meta,
    };
  }

  private findPrevDayBar(dayBars: any[], date: Date) {
    const ist   = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    const today = ist.toISOString().slice(0, 10);
    for (let i = dayBars.length - 1; i >= 0; i--) {
      const d = new Date(dayBars[i].timestamp.getTime() + 5.5 * 60 * 60 * 1000);
      if (d.toISOString().slice(0, 10) < today) return dayBars[i];
    }
    return null;
  }

  private timeToWeeklyExpiry(date: Date): number {
    const ist             = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    const dow             = ist.getUTCDay();
    const daysToThursday  = ((4 - dow + 7) % 7) || 7;
    const hoursLeft       = 15.5 - (ist.getUTCHours() + ist.getUTCMinutes() / 60);
    return Math.max((daysToThursday - 1 + hoursLeft / 6.25) / 365, 1 / 365);
  }
}
