import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { MarketBar, MarketBarDocument } from '../market-data/schemas/market-bar.schema';
import { IVCrushTrade, IVCrushTradeDocument } from './schemas/iv-crush-trade.schema';
import {
  atmStraddle, tFromTimestamp, todayKeyIST,
  istHHMM, RISK_FREE, upsertSkippedTrade,
} from '../strategies/option-indicators';
import { computeTradeSummary } from '../backtest-shared/metrics.util';

// ── Constants ─────────────────────────────────────────────────────────────────
export interface BtTrade {
  date: string;
  entryStraddle: number;
  exitStraddle: number;
  lots: number;
  netPnl: number;
  exitReason: 'TP' | 'SL' | 'TIME';
  vix: number;
  gapPct: number;
  spot: number;
  strike: number;
}

const LOT_SIZE    = 65;
const MAX_RISK    = 5_000;
const BROKERAGE   = 80;        // per lot per leg
const GAP_FILTER  = 0.8;       // % — skip if overnight gap > this
const TP_PCT      = 0.15;      // exit when straddle decays 15%
const SL_PCT      = 1.0;       // exit when straddle doubles
const MORNING_IV_PREMIUM = 1.08; // entry IV = VIX × 1.08

// ── Last-tick diagnostic ──────────────────────────────────────────────────────

export interface LastTickIVC {
  time: string;
  istHHMM: number;
  status: string;
  message: string;
  trade?: {
    spot: number;
    strike: number;
    entryStraddle: number;
    currentStraddle: number;
    pnlPct: number;
    pnl: number;
    lots: number;
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class IVCrushService {
  private readonly logger = new Logger(IVCrushService.name);
  private lastTick: LastTickIVC | null = null;

  constructor(
    @InjectModel(MarketBar.name)   private barModel: Model<MarketBarDocument>,
    @InjectModel(IVCrushTrade.name) private tradeModel: Model<IVCrushTradeDocument>,
  ) {}

  // Runs every 5 min, 9:15 AM – 10:15 AM IST (3:45–4:45 UTC)
  @Cron('*/5 3-4 * * 1-5', { timeZone: 'UTC' })
  async tick() {
    const now = new Date();
    const hhmm = istHHMM(now);
    const dk = todayKeyIST(now);

    // Outside operating window
    if (hhmm < 915 || hhmm > 1010) {
      this.lastTick = { time: now.toISOString(), istHHMM: hhmm, status: 'OUTSIDE_WINDOW', message: `Outside window (${hhmm})` };
      return;
    }

    try {
      const existing = await this.tradeModel.findOne({ date: dk });

      // Already closed or skipped today — nothing to do
      if (existing?.status === 'CLOSED' || existing?.status === 'SKIPPED') {
        this.lastTick = {
          time: now.toISOString(), istHHMM: hhmm,
          status: existing.status,
          message: existing.status === 'SKIPPED'
            ? `Skipped: ${existing.skipReason}`
            : `Closed @ ${existing.exitReason} | P&L ₹${existing.netPnl}`,
        };
        return;
      }

      // Manage open trade
      if (existing?.status === 'OPEN') {
        await this.manageTrade(existing, now, hhmm);
        return;
      }

      // Try entry between 9:20–9:40 AM (extended to handle Angel One rate-limit delays)
      if (hhmm >= 920 && hhmm <= 940) {
        await this.tryEntry(dk, now);
      } else {
        this.lastTick = { time: now.toISOString(), istHHMM: hhmm, status: 'WAITING', message: `Waiting for 9:20 AM entry window` };
      }
    } catch (err: any) {
      this.logger.error(`IV Crush tick error: ${err.message}`);
      this.lastTick = { time: now.toISOString(), istHHMM: hhmm, status: 'ERROR', message: err.message };
    }
  }

  private async tryEntry(dk: string, now: Date) {
    const hhmm = istHHMM(now);

    // Load today's 5-min bars
    const todayOpen = new Date(now);
    todayOpen.setUTCHours(3, 45, 0, 0); // 9:15 IST
    const bars = await this.barModel
      .find({ symbol: 'NIFTY 50', exchange: 'NSE', interval: '5minute', timestamp: { $gte: todayOpen, $lte: now } })
      .sort({ timestamp: 1 }).lean();

    if (bars.length < 2) {
      this.lastTick = { time: now.toISOString(), istHHMM: hhmm, status: 'WAITING', message: `Waiting for bars (${bars.length} so far)` };
      return;
    }

    // The 9:20 AM bar = index 1 (9:15 = index 0)
    const entryBar = bars[1];
    const spot = entryBar.close;

    // Gap filter: check yesterday's last bar
    const yesterday = new Date(todayOpen.getTime() - 86_400_000);
    const prevBars = await this.barModel
      .find({ symbol: 'NIFTY 50', exchange: 'NSE', interval: '5minute', timestamp: { $gte: yesterday, $lt: todayOpen } })
      .sort({ timestamp: -1 }).limit(1).lean();

    if (!prevBars.length) {
      await this.createSkipped(dk, 'No previous day data');
      return;
    }

    const prevClose = prevBars[0].close;
    const gapPct = Math.abs((spot - prevClose) / prevClose) * 100;

    if (gapPct > GAP_FILTER) {
      const reason = `Gap ${gapPct.toFixed(2)}% > ${GAP_FILTER}%`;
      this.logger.log(`IV Crush SKIP: ${reason}`);
      await this.createSkipped(dk, reason);
      this.lastTick = { time: now.toISOString(), istHHMM: hhmm, status: 'SKIPPED', message: `Skipped: ${reason}` };
      return;
    }

    // VIX
    const vixBar = await this.barModel
      .findOne({ symbol: 'INDIA VIX', exchange: 'NSE', interval: 'day' })
      .sort({ timestamp: -1 }).lean();
    const vix = vixBar ? vixBar.close : 15;
    const sigma = (vix / 100) * MORNING_IV_PREMIUM;

    // Straddle pricing
    const strike = Math.round(spot / 50) * 50;
    const T = tFromTimestamp(entryBar.timestamp);
    const entryStraddle = atmStraddle(spot, T, sigma);
    const lots = Math.max(1, Math.floor(MAX_RISK / (entryStraddle * LOT_SIZE)));

    await this.tradeModel.create({
      date: dk,
      status: 'OPEN',
      entryTime: entryBar.timestamp,
      spot,
      strike,
      entryStraddle: Math.round(entryStraddle * 100) / 100,
      lots,
      vix,
      gapPct: Math.round(gapPct * 100) / 100,
      currentStraddle: Math.round(entryStraddle * 100) / 100,
      currentPnl: 0,
      lastUpdated: now,
    });

    this.logger.log(`IV Crush ENTRY: spot=${spot} strike=${strike} straddle=${entryStraddle.toFixed(1)} lots=${lots} vix=${vix}`);
    this.lastTick = {
      time: now.toISOString(), istHHMM: hhmm, status: 'OPEN',
      message: `*** ENTRY: spot=${spot} | straddle=₹${entryStraddle.toFixed(1)} | ${lots} lot(s) | strike=${strike} ***`,
      trade: { spot, strike, entryStraddle, currentStraddle: entryStraddle, pnlPct: 0, pnl: 0, lots },
    };
  }

  private async manageTrade(trade: IVCrushTradeDocument, now: Date, hhmm: number) {
    // Load latest 5-min bar
    const bar = await this.barModel
      .findOne({ symbol: 'NIFTY 50', exchange: 'NSE', interval: '5minute', timestamp: { $lte: now } })
      .sort({ timestamp: -1 }).lean();

    if (!bar) return;

    const T = tFromTimestamp(bar.timestamp);
    const vix = trade.vix ?? 15;
    const sigma = vix / 100;
    const currentStraddle = atmStraddle(bar.close, T, sigma);
    const pnlPct = (trade.entryStraddle - currentStraddle) / trade.entryStraddle;
    const grossPnl = (trade.entryStraddle - currentStraddle) * trade.lots * LOT_SIZE;
    const netPnl = grossPnl - trade.lots * BROKERAGE * 2;

    // Update live tracking
    await this.tradeModel.updateOne({ _id: trade._id }, {
      currentStraddle: Math.round(currentStraddle * 100) / 100,
      currentPnl: Math.round(netPnl),
      lastUpdated: now,
    });

    // Check exit conditions
    let exitReason: string | null = null;
    if (pnlPct >= TP_PCT)  exitReason = 'TP';
    if (pnlPct <= -SL_PCT) exitReason = 'SL';
    if (hhmm >= 1000)      exitReason = 'TIME';

    if (exitReason) {
      await this.tradeModel.updateOne({ _id: trade._id }, {
        status: 'CLOSED',
        exitTime: bar.timestamp,
        exitStraddle: Math.round(currentStraddle * 100) / 100,
        exitReason,
        grossPnl: Math.round(grossPnl),
        netPnl: Math.round(netPnl),
      });
      this.logger.log(`IV Crush EXIT: ${exitReason} | straddle=${currentStraddle.toFixed(1)} | P&L ₹${Math.round(netPnl)}`);
      this.lastTick = {
        time: now.toISOString(), istHHMM: hhmm, status: 'CLOSED',
        message: `CLOSED ${exitReason} | entry=${trade.entryStraddle} → exit=${currentStraddle.toFixed(1)} | P&L ₹${Math.round(netPnl)}`,
        trade: { spot: bar.close, strike: trade.strike, entryStraddle: trade.entryStraddle, currentStraddle, pnlPct: Math.round(pnlPct * 10000) / 100, pnl: Math.round(netPnl), lots: trade.lots },
      };
    } else {
      this.lastTick = {
        time: now.toISOString(), istHHMM: hhmm, status: 'OPEN',
        message: `OPEN | straddle ${trade.entryStraddle} → ${currentStraddle.toFixed(1)} (${(pnlPct * 100).toFixed(1)}%) | P&L ₹${Math.round(netPnl)}`,
        trade: { spot: bar.close, strike: trade.strike, entryStraddle: trade.entryStraddle, currentStraddle, pnlPct: Math.round(pnlPct * 10000) / 100, pnl: Math.round(netPnl), lots: trade.lots },
      };
    }
  }

  private async createSkipped(dk: string, reason: string) {
    await upsertSkippedTrade(this.tradeModel, dk, reason);
  }

  // ── Controller methods ────────────────────────────────────────────────────

  getLastTick() { return this.lastTick; }

  async forceTick() {
    await this.tick();
    return this.lastTick;
  }

  async getToday() {
    const dk = todayKeyIST(new Date());
    return this.tradeModel.findOne({ date: dk }).lean();
  }

  async getRecent(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const fromDk = todayKeyIST(from);
    return this.tradeModel.find({ date: { $gte: fromDk } }).sort({ date: -1 }).lean();
  }

  async getSummary(days = 30) {
    const trades = await this.getRecent(days);
    return computeTradeSummary(trades);
  }

  // ── Backtest ──────────────────────────────────────────────────────────────

  async runBacktest(_userId: string, fromDate: string, toDate: string, initialCapital = 100_000) {
    const from = new Date(fromDate);
    const to   = new Date(toDate);

    // Load all 5-min NIFTY bars in range
    const bars = await this.barModel
      .find({
        symbol: 'NIFTY 50',
        exchange: 'NSE',
        interval: '5minute',
        timestamp: { $gte: from, $lte: to },
      })
      .sort({ timestamp: 1 })
      .lean();

    if (!bars.length) {
      return { trades: [], metrics: this.emptyMetrics(initialCapital) };
    }

    // Load VIX daily bars
    const vixBars = await this.barModel
      .find({ symbol: 'INDIA VIX', exchange: 'NSE', interval: 'day' })
      .sort({ timestamp: 1 })
      .lean();
    const vixMap = new Map<string, number>();
    for (const v of vixBars) {
      vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);
    }

    // Group bars by trading day
    const dayMap = new Map<string, typeof bars>();
    for (const bar of bars) {
      const dk = todayKeyIST(bar.timestamp);
      if (!dayMap.has(dk)) dayMap.set(dk, []);
      dayMap.get(dk)!.push(bar);
    }

    const tradeDays = [...dayMap.keys()].sort();
    const btTrades: BtTrade[] = [];

    for (let i = 0; i < tradeDays.length; i++) {
      const dk      = tradeDays[i];
      const dayBars = dayMap.get(dk)!;

      // Find entry bar at 9:20 AM
      const entryBar = dayBars.find(b => istHHMM(b.timestamp) === 920);
      if (!entryBar) continue;

      const spot = entryBar.close;

      // Gap filter: yesterday's last bar
      let gapPct = 0;
      if (i > 0) {
        const prevDk   = tradeDays[i - 1];
        const prevBars = dayMap.get(prevDk)!;
        const prevClose = prevBars[prevBars.length - 1].close;
        gapPct = Math.abs((spot - prevClose) / prevClose) * 100;
        if (gapPct > GAP_FILTER) continue;
      }

      // VIX — use the value from the entry day or the day before
      const vix = vixMap.get(dk) ?? vixMap.get(tradeDays[i - 1] ?? '') ?? 15;
      const sigmaMorning = (vix / 100) * MORNING_IV_PREMIUM;
      const sigmaNormal  = vix / 100;

      // Price straddle at entry
      const T0            = tFromTimestamp(entryBar.timestamp);
      const entryStraddle = atmStraddle(spot, T0, sigmaMorning);
      const lots          = Math.max(1, Math.floor(MAX_RISK / (entryStraddle * LOT_SIZE)));

      // Simulate bars from 9:25 AM onwards until 10:00 AM exit
      let exitStraddle = entryStraddle;
      let exitReason: 'TP' | 'SL' | 'TIME' = 'TIME';

      const simBars = dayBars.filter(b => {
        const hhmm = istHHMM(b.timestamp);
        return hhmm >= 925 && hhmm <= 1000;
      });

      for (const bar of simBars) {
        const hhmm = istHHMM(bar.timestamp);
        const T    = tFromTimestamp(bar.timestamp);
        const cs   = atmStraddle(bar.close, T, sigmaNormal);

        // TP: straddle decayed 15%
        if (cs < entryStraddle * (1 - TP_PCT)) {
          exitStraddle = cs;
          exitReason   = 'TP';
          break;
        }

        // SL: straddle doubled (SL_PCT = 1.0 means 100% increase)
        if (cs > entryStraddle * (1 + SL_PCT)) {
          exitStraddle = cs;
          exitReason   = 'SL';
          break;
        }

        // TIME: 10:00 AM or beyond → force exit
        if (hhmm >= 1000) {
          exitStraddle = cs;
          exitReason   = 'TIME';
          break;
        }

        // Last bar in window — TIME exit
        exitStraddle = cs;
      }

      const grossPnl = (entryStraddle - exitStraddle) * lots * LOT_SIZE;
      const netPnl   = Math.round(grossPnl - lots * BROKERAGE * 2);

      btTrades.push({
        date: dk,
        entryStraddle: Math.round(entryStraddle * 100) / 100,
        exitStraddle:  Math.round(exitStraddle  * 100) / 100,
        lots,
        netPnl,
        exitReason,
        vix: Math.round(vix * 100) / 100,
        gapPct: Math.round(gapPct * 100) / 100,
        spot: Math.round(spot),
        strike: Math.round(spot / 50) * 50,
      });
    }

    const metrics = this.computeBacktestMetrics(btTrades, initialCapital);
    return { trades: btTrades, metrics };
  }

  private computeBacktestMetrics(
    trades: Array<{ date: string; netPnl: number }>,
    init: number,
  ) {
    if (!trades.length) return this.emptyMetrics(init);

    const wins   = trades.filter(t => t.netPnl > 0);
    const losses = trades.filter(t => t.netPnl <= 0);
    const gp     = wins.reduce((s, t)   => s + t.netPnl, 0);
    const gl     = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));

    // Drawdown & equity curve
    let equity = init, peak = init, maxDD = 0;
    const equityCurve: { t: string; e: number }[] = [];
    for (const t of [...trades].sort((a, b) => a.date.localeCompare(b.date))) {
      equity += t.netPnl;
      peak    = Math.max(peak, equity);
      maxDD   = Math.max(maxDD, peak - equity);
      equityCurve.push({ t: t.date, e: +equity.toFixed(2) });
    }

    // Sharpe
    const RFDR = 0.065 / 252;
    let re = init;
    const dayReturns: number[] = [];
    const dayPnl = new Map<string, number>();
    trades.forEach(t => dayPnl.set(t.date, (dayPnl.get(t.date) ?? 0) + t.netPnl));
    for (const [, p] of [...dayPnl.entries()].sort()) {
      dayReturns.push(p / re - RFDR);
      re += p;
    }
    const mean   = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const stdDev = (a: number[]) => {
      if (a.length < 2) return 0;
      const m = mean(a);
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
    };
    const sharpe = dayReturns.length > 1
      ? +(mean(dayReturns) / (stdDev(dayReturns) || 1e-10) * Math.sqrt(252)).toFixed(2)
      : 0;

    return {
      totalTrades:  trades.length,
      wins:         wins.length,
      losses:       losses.length,
      winRate:      +((wins.length / trades.length) * 100).toFixed(1),
      netPnl:       +(gp - gl).toFixed(2),
      profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : 99,
      avgWin:       wins.length   ? +(gp / wins.length).toFixed(2)   : 0,
      avgLoss:      losses.length ? +(gl / losses.length).toFixed(2) : 0,
      maxDrawdown:  +maxDD.toFixed(2),
      sharpeRatio:  sharpe,
      roi:          +(((gp - gl) / init) * 100).toFixed(2),
      finalCapital: +(init + (gp - gl)).toFixed(2),
      equityCurve,
    };
  }

  private emptyMetrics(init: number) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0,
      profitFactor: 0, avgWin: 0, avgLoss: 0, maxDrawdown: 0,
      sharpeRatio: 0, roi: 0, finalCapital: init, equityCurve: [],
    };
  }

  async simulateTrades(fromDate: string, toDate: string) {
    const result = await this.runBacktest('', fromDate, toDate);
    return result.trades.map(t => ({
      ...t,
      _strategy: 'C1' as const,
      symbol: 'NIFTY 50',
      entryTime: t.date + 'T03:50:00.000Z', // 9:20 AM IST
      exitTime:  t.date + 'T04:30:00.000Z', // 10:00 AM IST
      exitReason: t.exitReason,
    }));
  }
}
