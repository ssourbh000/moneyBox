import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { MarketBar, MarketBarDocument } from '../market-data/schemas/market-bar.schema';
import { EventAlphaTrade, EventAlphaTradeDocument } from './schemas/event-alpha-trade.schema';
import {
  atmStraddle, tFromTimestamp, todayKeyIST,
  istHHMM, upsertSkippedTrade,
} from '../strategies/option-indicators';
import { computeTradeSummary } from '../backtest-shared/metrics.util';

// ── Constants ─────────────────────────────────────────────────────────────────
const LOT_SIZE   = 65;
const MAX_RISK   = 5_000;
const BROKERAGE  = 80;       // per lot per leg
const TP_MULT    = 2.0;      // exit when straddle >= entry × 2.0 (100% gain)
const SL_MULT    = 0.5;      // exit when straddle <= entry × 0.5 (50% loss)
const VIX_THRESH = 18;       // prev-day VIX threshold
const GAP_THRESH = 1.2;      // overnight gap threshold %

// ── Last-tick diagnostic ──────────────────────────────────────────────────────

export interface LastTickEA {
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
    eventType: string;
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class EventAlphaPaperService {
  private readonly logger = new Logger(EventAlphaPaperService.name);
  private lastTick: LastTickEA | null = null;

  constructor(
    @InjectModel(MarketBar.name)        private barModel: Model<MarketBarDocument>,
    @InjectModel(EventAlphaTrade.name)  private tradeModel: Model<EventAlphaTradeDocument>,
  ) {}

  // Runs every 5 min, 9:15 AM–3:35 PM IST (3:45–10:05 AM UTC)
  @Cron('4-59/5 3-9 * * 1-5', { timeZone: 'UTC' })
  async tick() {
    const now = new Date();
    const hhmm = istHHMM(now);
    const dk = todayKeyIST(now);

    // Outside operating window
    if (hhmm < 915 || hhmm > 1435) {
      this.lastTick = {
        time: now.toISOString(), istHHMM: hhmm,
        status: 'OUTSIDE_WINDOW',
        message: `Outside window (${hhmm})`,
      };
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
      if (hhmm >= 920 && hhmm <= 940) {
        await this.tryEntry(dk, now);
      } else {
        this.lastTick = {
          time: now.toISOString(), istHHMM: hhmm,
          status: 'WAITING',
          message: `Waiting for 9:20 AM entry window`,
        };
      }
    } catch (err: any) {
      this.logger.error(`Event Alpha tick error: ${err.message}`);
      this.lastTick = { time: now.toISOString(), istHHMM: hhmm, status: 'ERROR', message: err.message };
    }
  }

  private async tryEntry(dk: string, now: Date) {
    const hhmm = istHHMM(now);

    // Today's 9:15 AM UTC-equivalent open
    const todayOpen = new Date(now);
    todayOpen.setUTCHours(3, 45, 0, 0); // 9:15 IST

    // Load today's first two 5-min bars (9:15 and 9:20 bars)
    const todayBars = await this.barModel
      .find({
        symbol: 'NIFTY 50', exchange: 'NSE', interval: '5minute',
        timestamp: { $gte: todayOpen, $lte: now },
      })
      .sort({ timestamp: 1 }).lean();

    if (todayBars.length < 2) {
      this.lastTick = {
        time: now.toISOString(), istHHMM: hhmm,
        status: 'WAITING',
        message: `Waiting for bars (${todayBars.length} so far)`,
      };
      return;
    }

    const firstBar  = todayBars[0]; // 9:15 bar — today open
    const entryBar  = todayBars[1]; // 9:20 bar — entry bar
    const todayOpen1 = firstBar.open;
    const spot = entryBar.close;

    // Get yesterday's last bar (for prev close and gap calculation)
    const prevDayBars = await this.barModel
      .find({
        symbol: 'NIFTY 50', exchange: 'NSE', interval: '5minute',
        timestamp: { $lt: todayOpen },
      })
      .sort({ timestamp: -1 }).limit(1).lean();

    if (!prevDayBars.length) {
      await this.createSkipped(dk, 'No previous day data');
      this.lastTick = { time: now.toISOString(), istHHMM: hhmm, status: 'SKIPPED', message: 'No previous day data' };
      return;
    }

    const prevClose = prevDayBars[0].close;
    const gapPct = ((todayOpen1 - prevClose) / prevClose) * 100;

    // Get yesterday's VIX daily bar
    const vixBar = await this.barModel
      .findOne({ symbol: 'INDIA VIX', exchange: 'NSE', interval: 'day', timestamp: { $lt: todayOpen } })
      .sort({ timestamp: -1 }).lean();
    const prevVix = vixBar ? vixBar.close : 0;

    // Check event conditions
    const isVixSpike = prevVix > VIX_THRESH;
    const isGapDay   = Math.abs(gapPct) > GAP_THRESH;

    if (!isVixSpike && !isGapDay) {
      const reason = `Not an event day (VIX ${prevVix.toFixed(1)} ≤ ${VIX_THRESH}, gap ${gapPct.toFixed(2)}% ≤ ±${GAP_THRESH}%)`;
      this.logger.log(`Event Alpha SKIP: ${reason}`);
      await this.createSkipped(dk, reason);
      this.lastTick = { time: now.toISOString(), istHHMM: hhmm, status: 'SKIPPED', message: `Skipped: ${reason}` };
      return;
    }

    const eventType = isVixSpike && isGapDay ? 'VIX_SPIKE+GAP' : isVixSpike ? 'VIX_SPIKE' : 'GAP';

    // Pricing: straight VIX/100 as sigma (buy — no morning premium inflation)
    const vix = vixBar ? vixBar.close : 15;
    const sigma = vix / 100;
    const strike = Math.round(spot / 50) * 50;
    const T = tFromTimestamp(entryBar.timestamp);
    const entryStraddle = atmStraddle(spot, T, sigma);
    const lots = Math.max(1, Math.floor(MAX_RISK / (entryStraddle * LOT_SIZE)));

    await this.tradeModel.create({
      date: dk,
      status: 'OPEN',
      eventType,
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

    this.logger.log(`Event Alpha ENTRY: eventType=${eventType} spot=${spot} strike=${strike} straddle=${entryStraddle.toFixed(1)} lots=${lots} vix=${vix} gap=${gapPct.toFixed(2)}%`);
    this.lastTick = {
      time: now.toISOString(), istHHMM: hhmm, status: 'OPEN',
      message: `*** ENTRY: ${eventType} | spot=${spot} | straddle=₹${entryStraddle.toFixed(1)} | ${lots} lot(s) | strike=${strike} ***`,
      trade: { spot, strike, entryStraddle, currentStraddle: entryStraddle, pnlPct: 0, pnl: 0, lots, eventType },
    };
  }

  private async manageTrade(trade: EventAlphaTradeDocument, now: Date, hhmm: number) {
    // Load latest 5-min bar
    const bar = await this.barModel
      .findOne({ symbol: 'NIFTY 50', exchange: 'NSE', interval: '5minute', timestamp: { $lte: now } })
      .sort({ timestamp: -1 }).lean();

    if (!bar) return;

    const T = tFromTimestamp(bar.timestamp);
    const vix = trade.vix ?? 15;
    const sigma = vix / 100;
    const currentStraddle = atmStraddle(bar.close, T, sigma);

    // P&L for a BUY: profit when straddle increases
    const grossPnl = (currentStraddle - trade.entryStraddle) * trade.lots * LOT_SIZE;
    const netPnl   = grossPnl - trade.lots * BROKERAGE * 2;
    const pnlPct   = (currentStraddle - trade.entryStraddle) / trade.entryStraddle;

    // Update live tracking
    await this.tradeModel.updateOne({ _id: trade._id }, {
      currentStraddle: Math.round(currentStraddle * 100) / 100,
      currentPnl: Math.round(netPnl),
      lastUpdated: now,
    });

    // Check exit conditions
    let exitReason: string | null = null;
    if (currentStraddle >= trade.entryStraddle * TP_MULT) exitReason = 'TP';
    if (currentStraddle <= trade.entryStraddle * SL_MULT) exitReason = 'SL';
    if (hhmm >= 1430)                                      exitReason = 'TIME';

    const eventType = trade.eventType ?? 'UNKNOWN';

    if (exitReason) {
      await this.tradeModel.updateOne({ _id: trade._id }, {
        status: 'CLOSED',
        exitTime: bar.timestamp,
        exitStraddle: Math.round(currentStraddle * 100) / 100,
        exitReason,
        grossPnl: Math.round(grossPnl),
        netPnl: Math.round(netPnl),
      });
      this.logger.log(`Event Alpha EXIT: ${exitReason} | straddle=${currentStraddle.toFixed(1)} | P&L ₹${Math.round(netPnl)}`);
      this.lastTick = {
        time: now.toISOString(), istHHMM: hhmm, status: 'CLOSED',
        message: `CLOSED ${exitReason} | entry=₹${trade.entryStraddle} → exit=₹${currentStraddle.toFixed(1)} | P&L ₹${Math.round(netPnl)}`,
        trade: {
          spot: bar.close, strike: trade.strike, entryStraddle: trade.entryStraddle,
          currentStraddle, pnlPct: Math.round(pnlPct * 10000) / 100, pnl: Math.round(netPnl),
          lots: trade.lots, eventType,
        },
      };
    } else {
      this.lastTick = {
        time: now.toISOString(), istHHMM: hhmm, status: 'OPEN',
        message: `OPEN | straddle ₹${trade.entryStraddle} → ₹${currentStraddle.toFixed(1)} (${(pnlPct * 100).toFixed(1)}%) | P&L ₹${Math.round(netPnl)}`,
        trade: {
          spot: bar.close, strike: trade.strike, entryStraddle: trade.entryStraddle,
          currentStraddle, pnlPct: Math.round(pnlPct * 10000) / 100, pnl: Math.round(netPnl),
          lots: trade.lots, eventType,
        },
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
}
