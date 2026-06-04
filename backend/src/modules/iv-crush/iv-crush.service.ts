import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { MarketBar, MarketBarDocument } from '../market-data/schemas/market-bar.schema';
import { IVCrushTrade, IVCrushTradeDocument } from './schemas/iv-crush-trade.schema';

// ── Constants ─────────────────────────────────────────────────────────────────
const LOT_SIZE    = 25;
const MAX_RISK    = 5_000;
const BROKERAGE   = 80;        // per lot per leg
const RISK_FREE   = 0.065;
const GAP_FILTER  = 0.8;       // % — skip if overnight gap > this
const TP_PCT      = 0.15;      // exit when straddle decays 15%
const SL_PCT      = 1.0;       // exit when straddle doubles
const MORNING_IV_PREMIUM = 1.08; // entry IV = VIX × 1.08

// ── B-S helpers ───────────────────────────────────────────────────────────────

function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const result = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * poly;
  return x >= 0 ? result : 1 - result;
}

function bsPrice(S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0) return Math.max(type === 'call' ? S - K : K - S, 0);
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  if (type === 'call') return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

function daysToNextThursday(date: Date): number {
  const day = date.getUTCDay();
  if (day === 4) return 0;
  return day < 4 ? 4 - day : 7 - (day - 4);
}

function tFromTimestamp(ts: Date): number {
  const closeUTC = new Date(ts);
  closeUTC.setUTCHours(10, 0, 0, 0);
  const minsRemaining = Math.max(0, (closeUTC.getTime() - ts.getTime()) / 60_000);
  return (daysToNextThursday(ts) + minsRemaining / (24 * 60)) / 365;
}

function atmStraddle(S: number, T: number, sigma: number): number {
  const K = Math.round(S / 50) * 50;
  return bsPrice(S, K, T, RISK_FREE, sigma, 'call') + bsPrice(S, K, T, RISK_FREE, sigma, 'put');
}

// IST hhmm as number (e.g. 920 = 9:20 AM)
function istHHMM(ts: Date): number {
  const ist = new Date(ts.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 100 + ist.getUTCMinutes();
}

function todayKeyIST(ts: Date): string {
  const ist = new Date(ts.getTime() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

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

      // Try entry between 9:20–9:35 AM
      if (hhmm >= 920 && hhmm <= 935) {
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
    await this.tradeModel.findOneAndUpdate(
      { date: dk },
      { date: dk, status: 'SKIPPED', skipReason: reason },
      { upsert: true, new: true },
    );
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
    const closed = trades.filter(t => t.status === 'CLOSED');
    const wins   = closed.filter(t => t.netPnl > 0);
    const losses = closed.filter(t => t.netPnl <= 0);
    const netPnl = closed.reduce((s, t) => s + (t.netPnl ?? 0), 0);
    const grossWin = wins.reduce((s, t) => s + (t.netPnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.netPnl ?? 0), 0));

    return {
      total: closed.length,
      wins: wins.length,
      losses: losses.length,
      skipped: trades.filter(t => t.status === 'SKIPPED').length,
      winRate: closed.length ? Math.round((wins.length / closed.length) * 10000) / 100 : 0,
      netPnl: Math.round(netPnl),
      profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : 999,
      avgWin:  wins.length   ? Math.round(grossWin / wins.length) : 0,
      avgLoss: losses.length ? Math.round(-grossLoss / losses.length) : 0,
    };
  }
}
