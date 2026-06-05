import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketBar, MarketBarDocument } from '../market-data/schemas/market-bar.schema';
import {
  atmStraddle, tFromTimestamp, todayKeyIST, istHHMM,
} from '../strategies/option-indicators';
import { buildVixMap, computeMetrics } from '../backtest-shared/metrics.util';

// ── Constants ─────────────────────────────────────────────────────────────────
const LOT_SIZE           = 65;
const MAX_RISK           = 5_000;
const BROKERAGE          = 80;   // per lot per leg
const MORNING_IV_PREMIUM = 1.08;

// ── Params / result types ─────────────────────────────────────────────────────

export interface IVCrushSimParams {
  fromDate:   string;
  toDate:     string;
  capital:    number;
  tpPct:      number;   // e.g. 0.15 = exit when straddle decays 15%
  slPct:      number;   // e.g. 0.30 = exit when straddle rises 30%
  gapFilter:  number;   // e.g. 0.008 = skip if gap > 0.8%
}

export interface SimTrade {
  symbol:       string;
  date:         string;
  entryTime:    string;
  exitTime:     string;
  entryStraddle: number;
  exitStraddle:  number;
  lots:          number;
  netPnl:        number;
  exitReason:    'TP' | 'SL' | 'TIME';
  vix:           number;
  gapPct:        number;
  spot:          number;
  strike:        number;
}

export interface SimResult {
  params:  IVCrushSimParams;
  metrics: ReturnType<typeof computeMetrics> & { equityCurve: { t: string; e: number }[] };
  trades:  SimTrade[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class IVCrushSimulatorService {
  constructor(
    @InjectModel(MarketBar.name) private barModel: Model<MarketBarDocument>,
  ) {}

  async simulate(p: IVCrushSimParams): Promise<SimResult> {
    const from = new Date(p.fromDate);
    const to   = new Date(p.toDate);
    // Gap filter: convert fraction to percent (e.g. 0.008 → 0.8%)
    const gapFilterPct = p.gapFilter * 100;

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

    // Load VIX daily bars
    const vixBars = await this.barModel
      .find({ symbol: 'INDIA VIX', exchange: 'NSE', interval: 'day', timestamp: { $gte: from, $lte: to } })
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

      // Find entry bar at 9:20 AM
      const entryBar = dayBars.find(b => istHHMM(b.timestamp) === 920);
      if (!entryBar) continue;

      const spot = entryBar.close;

      // Gap filter: yesterday's last bar
      let gapPct = 0;
      if (i > 0) {
        const prevDk    = tradeDays[i - 1];
        const prevBars  = dayMap.get(prevDk)!;
        const prevClose = prevBars[prevBars.length - 1].close;
        gapPct = Math.abs((spot - prevClose) / prevClose) * 100;
        if (gapPct > gapFilterPct) continue;
      }

      // VIX — use the value from the entry day or the day before
      const vix          = vixMap.get(dk) ?? vixMap.get(tradeDays[i - 1] ?? '') ?? 15;
      const sigmaMorning = (vix / 100) * MORNING_IV_PREMIUM;
      const sigmaNormal  = vix / 100;

      // Price straddle at entry
      const T0            = tFromTimestamp(entryBar.timestamp);
      const entryStraddle = atmStraddle(spot, T0, sigmaMorning);
      const lots          = Math.max(1, Math.floor(MAX_RISK / (entryStraddle * LOT_SIZE)));

      // Simulate bars from 9:25 AM onwards until 10:00 AM exit
      let exitStraddle = entryStraddle;
      let exitReason: 'TP' | 'SL' | 'TIME' = 'TIME';
      let exitBar = entryBar;

      const simBars = dayBars.filter(b => {
        const hhmm = istHHMM(b.timestamp);
        return hhmm >= 925 && hhmm <= 1000;
      });

      for (const bar of simBars) {
        const hhmm = istHHMM(bar.timestamp);
        const T    = tFromTimestamp(bar.timestamp);
        const cs   = atmStraddle(bar.close, T, sigmaNormal);

        // TP: straddle decayed by tpPct
        if (cs < entryStraddle * (1 - p.tpPct)) {
          exitStraddle = cs;
          exitReason   = 'TP';
          exitBar      = bar;
          break;
        }

        // SL: straddle rose by slPct
        if (cs > entryStraddle * (1 + p.slPct)) {
          exitStraddle = cs;
          exitReason   = 'SL';
          exitBar      = bar;
          break;
        }

        // TIME: 10:00 AM or beyond → force exit
        if (hhmm >= 1000) {
          exitStraddle = cs;
          exitReason   = 'TIME';
          exitBar      = bar;
          break;
        }

        // Last bar in window — TIME exit
        exitStraddle = cs;
        exitBar      = bar;
      }

      const grossPnl = (entryStraddle - exitStraddle) * lots * LOT_SIZE;
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
        vix:    Math.round(vix    * 100) / 100,
        gapPct: Math.round(gapPct * 100) / 100,
        spot:   Math.round(spot),
        strike: Math.round(spot / 50) * 50,
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
