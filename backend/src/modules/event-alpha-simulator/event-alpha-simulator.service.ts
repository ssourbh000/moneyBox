import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketBar, MarketBarDocument } from '../market-data/schemas/market-bar.schema';
import {
  atmStraddle, tFromTimestamp, todayKeyIST, istHHMM,
} from '../strategies/option-indicators';
import { buildVixMap, computeMetrics } from '../backtest-shared/metrics.util';

// ── Constants ─────────────────────────────────────────────────────────────────
const LOT_SIZE  = 65;
const MAX_RISK  = 5_000;
const BROKERAGE = 80;   // per lot per leg

// ── Params / result types ─────────────────────────────────────────────────────

export interface EventAlphaSimParams {
  fromDate:   string;
  toDate:     string;
  capital:    number;
  tpMult:     number;   // e.g. 2.0 = TP when straddle >= entry × 2.0
  slMult:     number;   // e.g. 0.5 = SL when straddle <= entry × 0.5
  vixThresh:  number;   // e.g. 18 = event day if prev VIX > 18
  gapThresh:  number;   // e.g. 0.012 = event day if gap > 1.2%
}

export interface SimTrade {
  symbol:        string;
  date:          string;
  entryTime:     string;
  exitTime:      string;
  entryStraddle: number;
  exitStraddle:  number;
  lots:          number;
  netPnl:        number;
  exitReason:    'TP' | 'SL' | 'TIME';
  eventType:     string;
  vix:           number;
  gapPct:        number;
  spot:          number;
  strike:        number;
}

export interface SimResult {
  params:  EventAlphaSimParams;
  metrics: ReturnType<typeof computeMetrics> & { equityCurve: { t: string; e: number }[] };
  trades:  SimTrade[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class EventAlphaSimulatorService {
  constructor(
    @InjectModel(MarketBar.name) private barModel: Model<MarketBarDocument>,
  ) {}

  async simulate(p: EventAlphaSimParams): Promise<SimResult> {
    const from = new Date(p.fromDate);
    const to   = new Date(p.toDate);
    // Convert gapThresh fraction to percent (e.g. 0.012 → 1.2%)
    const gapThreshPct = p.gapThresh * 100;

    // Load all 5-min NIFTY bars in range
    const bars = await this.barModel
      .find({
        symbol: 'NIFTY 50', exchange: 'NSE', interval: '5minute',
        timestamp: { $gte: from, $lte: to },
      })
      .sort({ timestamp: 1 })
      .lean();

    if (!bars.length) {
      return { params: p, metrics: { ...this.emptyMetrics(p.capital), equityCurve: [] }, trades: [] };
    }

    // Load VIX daily bars (load from slightly before range to get prev-day VIX on first trading day)
    const vixFrom = new Date(from); vixFrom.setDate(vixFrom.getDate() - 10);
    const vixBars = await this.barModel
      .find({ symbol: 'INDIA VIX', exchange: 'NSE', interval: 'day', timestamp: { $gte: vixFrom, $lte: to } })
      .sort({ timestamp: 1 })
      .lean();
    const vixMap = buildVixMap(vixBars);

    // Group bars by trading day
    const dayMap = new Map<string, typeof bars>();
    for (const bar of bars) {
      const dk = todayKeyIST(bar.timestamp);
      if (!dayMap.has(dk)) dayMap.set(dk, []);
      dayMap.get(dk)!.push(bar);
    }

    const tradeDays = [...dayMap.keys()].sort();
    const simTrades: SimTrade[] = [];

    for (let i = 0; i < tradeDays.length; i++) {
      const dk      = tradeDays[i];
      const dayBars = dayMap.get(dk)!;

      // Need at least first two bars: 9:15 and 9:20
      const firstBar = dayBars.find(b => istHHMM(b.timestamp) === 915);
      const entryBar = dayBars.find(b => istHHMM(b.timestamp) === 920);
      if (!firstBar || !entryBar) continue;

      const todayOpen1 = firstBar.open;
      const spot       = entryBar.close;

      // Yesterday's last bar → prev close → gap
      let gapPct = 0;
      let prevClose = 0;
      if (i > 0) {
        const prevDk   = tradeDays[i - 1];
        const prevBars = dayMap.get(prevDk)!;
        prevClose = prevBars[prevBars.length - 1].close;
        gapPct    = ((todayOpen1 - prevClose) / prevClose) * 100;
      }

      // Prev-day VIX
      const prevDk  = tradeDays[i - 1] ?? '';
      const prevVix = vixMap.get(prevDk) ?? vixMap.get(dk) ?? 0;

      // Check event conditions
      const isVixSpike = prevVix > p.vixThresh;
      const isGapDay   = Math.abs(gapPct) > gapThreshPct;

      if (!isVixSpike && !isGapDay) continue; // not an event day — skip

      const eventType = isVixSpike && isGapDay ? 'VIX_SPIKE+GAP' : isVixSpike ? 'VIX_SPIKE' : 'GAP';

      // Pricing: straight VIX/100 as sigma (long straddle — no morning inflation)
      const vix    = vixMap.get(dk) ?? prevVix ?? 15;
      const sigma  = vix / 100;
      const strike = Math.round(spot / 50) * 50;
      const T0     = tFromTimestamp(entryBar.timestamp);
      const entryStraddle = atmStraddle(spot, T0, sigma);
      const lots          = Math.max(1, Math.floor(MAX_RISK / (entryStraddle * LOT_SIZE)));

      // Simulate bars from 9:25 AM through 2:30 PM (TIME exit)
      let exitStraddle = entryStraddle;
      let exitReason: 'TP' | 'SL' | 'TIME' = 'TIME';
      let exitBar = entryBar;

      const simBars = dayBars.filter(b => {
        const hhmm = istHHMM(b.timestamp);
        return hhmm >= 925 && hhmm <= 1430;
      });

      for (const bar of simBars) {
        const hhmm = istHHMM(bar.timestamp);
        const T    = tFromTimestamp(bar.timestamp);
        const cs   = atmStraddle(bar.close, T, sigma);

        // TP: straddle reached tpMult × entry
        if (cs >= entryStraddle * p.tpMult) {
          exitStraddle = cs;
          exitReason   = 'TP';
          exitBar      = bar;
          break;
        }

        // SL: straddle dropped to slMult × entry
        if (cs <= entryStraddle * p.slMult) {
          exitStraddle = cs;
          exitReason   = 'SL';
          exitBar      = bar;
          break;
        }

        // TIME: 2:30 PM or beyond → force exit
        if (hhmm >= 1430) {
          exitStraddle = cs;
          exitReason   = 'TIME';
          exitBar      = bar;
          break;
        }

        // Carry forward last known price
        exitStraddle = cs;
        exitBar      = bar;
      }

      // Long straddle P&L: profit when straddle increases
      const grossPnl = (exitStraddle - entryStraddle) * lots * LOT_SIZE;
      const netPnl   = Math.round(grossPnl - lots * BROKERAGE * 2);

      simTrades.push({
        symbol:        'NIFTY 50',
        date:          dk,
        entryTime:     entryBar.timestamp.toISOString(),
        exitTime:      exitBar.timestamp.toISOString(),
        entryStraddle: Math.round(entryStraddle * 100) / 100,
        exitStraddle:  Math.round(exitStraddle  * 100) / 100,
        lots,
        netPnl,
        exitReason,
        eventType,
        vix:    Math.round(vix    * 100) / 100,
        gapPct: Math.round(gapPct * 100) / 100,
        spot:   Math.round(spot),
        strike,
      });
    }

    const metrics = computeMetrics(
      simTrades.map(t => ({ netPnl: t.netPnl, exitTime: t.exitTime })),
      p.capital,
    );

    // Build equity curve
    let equity = p.capital;
    const equityCurve = [...simTrades]
      .sort((a, b) => a.exitTime.localeCompare(b.exitTime))
      .map(t => {
        equity += t.netPnl;
        return { t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) };
      });

    return { params: p, metrics: { ...metrics, equityCurve }, trades: simTrades };
  }

  private emptyMetrics(init: number) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0,
      grossProfit: 0, grossLoss: 0, profitFactor: 0, avgWin: 0, avgLoss: 0,
      expectancy: 0, maxDrawdown: 0, sharpeRatio: 0, roi: 0, finalCapital: init,
    };
  }
}
