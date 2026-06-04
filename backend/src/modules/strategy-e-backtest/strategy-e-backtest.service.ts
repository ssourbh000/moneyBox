import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketBar, MarketBarDocument } from '../market-data/schemas/market-bar.schema';

// ── Constants ─────────────────────────────────────────────────────────────────
const LOT_SIZE = 25;
const MAX_RISK = 5_000;
const BROKERAGE_PER_LOT = 80;
const RISK_FREE = 0.065;

// ── Math helpers ──────────────────────────────────────────────────────────────
function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
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

function atmStraddle(S: number, T: number, sigma: number): number {
  const K = Math.round(S / 50) * 50;
  return bsPrice(S, K, T, RISK_FREE, sigma, 'call') + bsPrice(S, K, T, RISK_FREE, sigma, 'put');
}

function creditSpread(S: number, T: number, sigma: number, dir: 'bear-call' | 'bull-put'): number {
  const K = Math.round(S / 50) * 50;
  if (dir === 'bear-call') {
    return bsPrice(S, K, T, RISK_FREE, sigma, 'call') - bsPrice(S, K + 100, T, RISK_FREE, sigma, 'call');
  }
  return bsPrice(S, K, T, RISK_FREE, sigma, 'put') - bsPrice(S, K - 100, T, RISK_FREE, sigma, 'put');
}

function atmOption(S: number, T: number, sigma: number, type: 'call' | 'put'): number {
  const K = Math.round(S / 50) * 50;
  return bsPrice(S, K, T, RISK_FREE, sigma, type);
}

// Days to next Thursday (NIFTY weekly expiry)
function daysToNextThursday(date: Date): number {
  const day = date.getUTCDay(); // 4 = Thu
  if (day === 4) return 0;
  return day < 4 ? 4 - day : 7 - (day - 4);
}

// T in years from a bar's timestamp to expiry (3:30 PM IST = 10:00 UTC)
function tFromTimestamp(ts: Date): number {
  const closeUTC = new Date(ts);
  closeUTC.setUTCHours(10, 0, 0, 0); // 3:30 PM IST
  const minsRemaining = Math.max(0, (closeUTC.getTime() - ts.getTime()) / 60_000);
  const days = daysToNextThursday(ts);
  return (days + minsRemaining / (24 * 60)) / 365;
}

// IST hhmm (e.g. 935 = 9:35 AM IST)
function istHHMM(ts: Date): number {
  const istMs = ts.getTime() + 330 * 60_000;
  const d = new Date(istMs);
  return d.getUTCHours() * 100 + d.getUTCMinutes();
}

// ── Indicator helpers ─────────────────────────────────────────────────────────

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(period - 1).fill(NaN);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function atr(bars: any[], period: number): number[] {
  const trs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = i > 0 ? bars[i - 1].close : bars[i].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const out: number[] = new Array(period - 1).fill(NaN);
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  out.push(a);
  for (let i = period; i < trs.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out.push(a);
  }
  return out;
}

function supertrendDir(bars: any[], period = 14, mult = 3): number[] {
  const atrs = atr(bars, period);
  const dirs: number[] = new Array(bars.length).fill(1);
  let ub = 0, lb = 0;
  for (let i = period; i < bars.length; i++) {
    if (isNaN(atrs[i])) continue;
    const mid = (bars[i].high + bars[i].low) / 2;
    const rawUB = mid + mult * atrs[i];
    const rawLB = mid - mult * atrs[i];
    ub = rawUB < ub || bars[i - 1].close > ub ? rawUB : ub;
    lb = rawLB > lb || bars[i - 1].close < lb ? rawLB : lb;
    if (bars[i].close > ub) dirs[i] = 1;
    else if (bars[i].close < lb) dirs[i] = -1;
    else dirs[i] = dirs[i - 1];
  }
  return dirs;
}

function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(period).fill(NaN);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag * (period - 1) + g) / period;
    al = (al * (period - 1) + l) / period;
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return out;
}

function vwapSeries(bars: any[]): number[] {
  let cumV = 0, cumTPV = 0;
  return bars.map(b => {
    const tp = (b.high + b.low + b.close) / 3;
    cumTPV += tp * (b.volume || 1);
    cumV += b.volume || 1;
    return cumTPV / cumV;
  });
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function dayKey(ts: Date): string {
  const d = new Date(ts.getTime() + 330 * 60_000); // IST
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function groupByDay<T extends { timestamp: Date }>(bars: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const b of bars) {
    const k = dayKey(b.timestamp);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(b);
  }
  return m;
}

// ── Trade type ────────────────────────────────────────────────────────────────

export interface SEBTrade {
  date: string;
  strategy: 'C1' | 'C2' | 'E' | 'PS';
  leg: 'MORNING' | 'AFTERNOON';
  tradeType: 'SELL_STRADDLE' | 'BUY_OPTION' | 'SELL_SPREAD';
  direction?: 'CALL' | 'PUT' | 'STRADDLE';
  entryTime: string;
  exitTime: string;
  entryPremium: number;
  exitPremium: number;
  lots: number;
  lotSize: number;
  grossPnl: number;
  netPnl: number;
  exitReason: 'TP' | 'SL' | 'TIME';
  vix: number;
  meta: Record<string, number | string>;
}

export interface SEBMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  avgTradesPerDay: number;
  roi: number;
  finalCapital: number;
  equityCurve: { t: string; e: number }[];
}

export interface SEBResult {
  label: string;
  description: string;
  trades: SEBTrade[];
  metrics: SEBMetrics;
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function computeMetrics(trades: SEBTrade[], initialCapital = 100_000): SEBMetrics {
  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl <= 0);
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const profitFactor =
    losses.reduce((s, t) => s + Math.abs(t.netPnl), 0) === 0
      ? 999
      : wins.reduce((s, t) => s + t.netPnl, 0) /
        losses.reduce((s, t) => s + Math.abs(t.netPnl), 0);

  // Equity curve + drawdown
  const equity: number[] = [initialCapital];
  let peak = initialCapital, maxDD = 0;
  const equityCurve: { t: string; e: number }[] = [];
  for (const t of trades) {
    const e = equity[equity.length - 1] + t.netPnl;
    equity.push(e);
    equityCurve.push({ t: t.date, e: Math.round(e) });
    if (e > peak) peak = e;
    const dd = (peak - e) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Unique trading days
  const tradingDays = new Set(trades.map(t => t.date)).size;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 10000) / 100 : 0,
    netPnl: Math.round(netPnl),
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgWin: wins.length ? Math.round(wins.reduce((s, t) => s + t.netPnl, 0) / wins.length) : 0,
    avgLoss: losses.length ? Math.round(losses.reduce((s, t) => s + t.netPnl, 0) / losses.length) : 0,
    maxDrawdown: Math.round(maxDD * 10000) / 100,
    avgTradesPerDay: tradingDays ? Math.round((trades.length / tradingDays) * 100) / 100 : 0,
    roi: Math.round((netPnl / initialCapital) * 10000) / 100,
    finalCapital: Math.round(initialCapital + netPnl),
    equityCurve,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class StrategyEBacktestService {
  constructor(
    @InjectModel(MarketBar.name) private barModel: Model<MarketBarDocument>,
  ) {}

  async runAll(fromDate: Date, toDate: Date): Promise<{
    c1: SEBResult; c2: SEBResult; e: SEBResult; ps: SEBResult;
  }> {
    // Load extra 20 days before fromDate to seed indicators
    const seedFrom = new Date(fromDate.getTime() - 20 * 86_400_000);

    const [bars5m, bars15m, vixBars] = await Promise.all([
      this.barModel.find({ symbol: 'NIFTY 50', exchange: 'NSE', interval: '5minute', timestamp: { $gte: seedFrom, $lte: toDate } }).sort({ timestamp: 1 }).lean(),
      this.barModel.find({ symbol: 'NIFTY 50', exchange: 'NSE', interval: '15minute', timestamp: { $gte: seedFrom, $lte: toDate } }).sort({ timestamp: 1 }).lean(),
      this.barModel.find({ symbol: 'INDIA VIX', exchange: 'NSE', interval: 'day', timestamp: { $gte: seedFrom, $lte: toDate } }).sort({ timestamp: 1 }).lean(),
    ]);

    // VIX lookup: day key → close
    const vixMap = new Map<string, number>();
    for (const v of vixBars) vixMap.set(dayKey(v.timestamp), v.close);
    const getVix = (dk: string): number => vixMap.get(dk) ?? 15;

    // Group bars by day (only days within the actual range)
    const days5m = groupByDay(bars5m.filter(b => b.timestamp >= fromDate));
    const days15m = groupByDay(bars15m.filter(b => b.timestamp >= fromDate));
    const sortedDays = [...days5m.keys()].sort();

    // Pre-compute Supertrend directions on all 15-min bars (including seed)
    const stDirs = supertrendDir(bars15m, 14, 3);
    const stDirByTs = new Map<number, number>();
    bars15m.forEach((b, i) => stDirByTs.set(b.timestamp.getTime(), stDirs[i]));

    // Pre-compute EMA9/21 on all 5-min bars
    const closes5m = bars5m.map(b => b.close);
    const ema9_5m = ema(closes5m, 9);
    const ema21_5m = ema(closes5m, 21);
    const ema5mByTs = new Map<number, { e9: number; e21: number }>();
    bars5m.forEach((b, i) => ema5mByTs.set(b.timestamp.getTime(), { e9: ema9_5m[i], e21: ema21_5m[i] }));

    // Pre-compute RSI on all 5-min bars
    const rsi5m = rsi(closes5m, 14);
    const rsi5mByTs = new Map<number, number>();
    bars5m.forEach((b, i) => rsi5mByTs.set(b.timestamp.getTime(), rsi5m[i]));

    const c1Trades = this.runC1(sortedDays, days5m, bars5m, getVix);
    const c2Trades = this.runC2(sortedDays, days5m, days15m, bars15m, getVix, stDirByTs, ema5mByTs, rsi5mByTs);
    const eTrades = this.runE(sortedDays, days5m, days15m, bars15m, getVix, stDirByTs, ema5mByTs, rsi5mByTs);
    const psTrades = this.runPS(sortedDays, days5m, days15m, bars15m, getVix, stDirByTs);

    return {
      c1: { label: 'C1: Opening IV Crush', description: 'Sell ATM straddle at 9:20 AM, exit by 10:00 AM. Exploits morning IV premium that decays as price discovery completes.', trades: c1Trades, metrics: computeMetrics(c1Trades) },
      c2: { label: 'C2: Supertrend Flip', description: 'Buy ATM option on 15-min Supertrend direction flip + VWAP/EMA/RSI confirmation. Entry window 9:30 AM – 2:00 PM.', trades: c2Trades, metrics: computeMetrics(c2Trades) },
      e:  { label: 'E: Combined (C1 + C2)', description: 'Morning straddle sell (C1) + first Supertrend flip after 10:30 AM (C2). Up to 2 trades per day.', trades: eTrades, metrics: computeMetrics(eTrades) },
      ps: { label: 'PS: Pure Sell All-Day', description: 'Morning straddle sell + afternoon credit spread when price stretches >0.7% from VWAP with overbought/oversold RSI.', trades: psTrades, metrics: computeMetrics(psTrades) },
    };
  }

  // ── Candidate 1: Opening IV Crush ─────────────────────────────────────────

  private runC1(
    sortedDays: string[],
    days5m: Map<string, any[]>,
    allBars5m: any[],
    getVix: (dk: string) => number,
  ): SEBTrade[] {
    const trades: SEBTrade[] = [];
    const allDaysSorted = [...days5m.keys()].sort();

    for (const dk of sortedDays) {
      const bars = days5m.get(dk)!.sort((a, b) => a.timestamp - b.timestamp);
      if (bars.length < 4) continue;

      const vix = getVix(dk);
      const sigma = vix / 100;

      // Bar index 0 = 9:15 bar, index 1 = 9:20 bar
      const entryBar = bars[1]; // 9:20 AM bar
      if (!entryBar) continue;
      if (istHHMM(entryBar.timestamp) < 920 || istHHMM(entryBar.timestamp) > 925) continue;

      // Gap filter: skip if overnight gap > 0.8%
      const prevDayIdx = allDaysSorted.indexOf(dk) - 1;
      if (prevDayIdx < 0) continue;
      const prevBars = days5m.get(allDaysSorted[prevDayIdx]);
      if (!prevBars || prevBars.length === 0) continue;
      const prevClose = prevBars[prevBars.length - 1].close;
      const gapPct = Math.abs((entryBar.open - prevClose) / prevClose) * 100;
      if (gapPct > 0.8) continue;

      const spot = entryBar.close;
      const tEntry = tFromTimestamp(entryBar.timestamp);
      const entrySigma = sigma * 1.08; // morning IV premium ~8%
      const entryStraddle = atmStraddle(spot, tEntry, entrySigma);

      const lots = Math.max(1, Math.floor(MAX_RISK / (entryStraddle * LOT_SIZE)));

      // Walk forward until 10:00 AM
      let exitBar = entryBar;
      let exitStraddle = entryStraddle;
      let exitReason: 'TP' | 'SL' | 'TIME' = 'TIME';

      for (let i = 2; i < bars.length; i++) {
        const b = bars[i];
        const hhmm = istHHMM(b.timestamp);
        if (hhmm > 1000) break;

        const t = tFromTimestamp(b.timestamp);
        const sv = atmStraddle(b.close, t, sigma);

        const pnlPct = (entryStraddle - sv) / entryStraddle;
        if (pnlPct >= 0.15) { exitBar = b; exitStraddle = sv; exitReason = 'TP'; break; }
        if (pnlPct <= -1.0) { exitBar = b; exitStraddle = sv; exitReason = 'SL'; break; }

        exitBar = b;
        exitStraddle = sv;
        if (hhmm >= 1000) { exitReason = 'TIME'; break; }
      }

      // P&L for straddle seller: profit when straddle value drops
      const grossPnl = (entryStraddle - exitStraddle) * lots * LOT_SIZE;
      const netPnl = grossPnl - lots * BROKERAGE_PER_LOT * 2; // 2 legs

      trades.push({
        date: dk, strategy: 'C1', leg: 'MORNING', tradeType: 'SELL_STRADDLE', direction: 'STRADDLE',
        entryTime: entryBar.timestamp.toISOString(),
        exitTime: exitBar.timestamp.toISOString(),
        entryPremium: Math.round(entryStraddle * 100) / 100,
        exitPremium: Math.round(exitStraddle * 100) / 100,
        lots, lotSize: LOT_SIZE,
        grossPnl: Math.round(grossPnl), netPnl: Math.round(netPnl),
        exitReason, vix,
        meta: { gapPct: Math.round(gapPct * 100) / 100, spot: Math.round(spot) },
      });
    }
    return trades;
  }

  // ── Candidate 2: Supertrend Flip All-Day ──────────────────────────────────

  private runC2(
    sortedDays: string[],
    days5m: Map<string, any[]>,
    days15m: Map<string, any[]>,
    allBars15m: any[],
    getVix: (dk: string) => number,
    stDirByTs: Map<number, number>,
    ema5mByTs: Map<number, { e9: number; e21: number }>,
    rsi5mByTs: Map<number, number>,
  ): SEBTrade[] {
    return this.runSupertrendLeg(sortedDays, days5m, days15m, allBars15m, getVix, stDirByTs, ema5mByTs, rsi5mByTs, 930, 1400, 'C2');
  }

  private runSupertrendLeg(
    sortedDays: string[],
    days5m: Map<string, any[]>,
    days15m: Map<string, any[]>,
    allBars15m: any[],
    getVix: (dk: string) => number,
    stDirByTs: Map<number, number>,
    ema5mByTs: Map<number, { e9: number; e21: number }>,
    rsi5mByTs: Map<number, number>,
    entryFrom: number, // IST hhmm
    entryTo: number,
    strat: 'C2' | 'E',
  ): SEBTrade[] {
    const trades: SEBTrade[] = [];

    for (const dk of sortedDays) {
      const bars5 = (days5m.get(dk) ?? []).sort((a, b) => a.timestamp - b.timestamp);
      const bars15 = (days15m.get(dk) ?? []).sort((a, b) => a.timestamp - b.timestamp);
      if (bars5.length < 20 || bars15.length < 5) continue;

      const vix = getVix(dk);
      const sigma = vix / 100;
      const vwap = vwapSeries(bars5);
      let traded = false;

      // Find 15-min bars where Supertrend flips
      for (let i = 1; i < bars15.length; i++) {
        if (traded) break;
        const b15 = bars15[i];
        const hhmm = istHHMM(b15.timestamp);
        if (hhmm < entryFrom || hhmm > entryTo) continue;

        const prevDir = stDirByTs.get(bars15[i - 1].timestamp.getTime()) ?? 0;
        const curDir = stDirByTs.get(b15.timestamp.getTime()) ?? 0;
        if (curDir === prevDir || curDir === 0) continue; // no flip

        const dir: 'CALL' | 'PUT' = curDir === 1 ? 'CALL' : 'PUT';

        // Find matching 5-min bar at this timestamp
        const fiveBar = bars5.find(b => b.timestamp.getTime() === b15.timestamp.getTime()) ??
          bars5.filter(b => b.timestamp <= b15.timestamp).at(-1);
        if (!fiveBar) continue;

        const fiveIdx = bars5.indexOf(fiveBar);
        const vwapVal = vwap[fiveIdx];
        if (!vwapVal) continue;

        // VWAP filter
        if (dir === 'CALL' && fiveBar.close < vwapVal) continue;
        if (dir === 'PUT' && fiveBar.close > vwapVal) continue;

        // EMA filter
        const emaVals = ema5mByTs.get(fiveBar.timestamp.getTime());
        if (!emaVals || isNaN(emaVals.e9) || isNaN(emaVals.e21)) continue;
        if (dir === 'CALL' && emaVals.e9 <= emaVals.e21) continue;
        if (dir === 'PUT' && emaVals.e9 >= emaVals.e21) continue;

        // RSI filter: 35-65 (momentum zone, not exhausted)
        const rsiVal = rsi5mByTs.get(fiveBar.timestamp.getTime());
        if (!rsiVal || isNaN(rsiVal) || rsiVal < 35 || rsiVal > 65) continue;

        const spot = fiveBar.close;
        const tEntry = tFromTimestamp(fiveBar.timestamp);
        const entryPrem = atmOption(spot, tEntry, sigma, dir === 'CALL' ? 'call' : 'put');
        if (entryPrem < 5) continue; // too cheap — illiquid

        const lots = Math.max(1, Math.floor(MAX_RISK / (entryPrem * LOT_SIZE)));
        const tp = entryPrem * 1.60;
        const sl = entryPrem * 0.65;

        // Walk forward on 5-min bars
        let exitBar = fiveBar;
        let exitPrem = entryPrem;
        let exitReason: 'TP' | 'SL' | 'TIME' = 'TIME';

        for (let j = fiveIdx + 1; j < bars5.length; j++) {
          const nb = bars5[j];
          const nhhmm = istHHMM(nb.timestamp);
          if (nhhmm > 1430) { exitReason = 'TIME'; exitBar = nb; break; }

          const t = tFromTimestamp(nb.timestamp);
          const prem = atmOption(nb.close, t, sigma, dir === 'CALL' ? 'call' : 'put');
          exitBar = nb;
          exitPrem = prem;

          if (prem >= tp) { exitReason = 'TP'; break; }
          if (prem <= sl) { exitReason = 'SL'; break; }
        }

        const grossPnl = (exitPrem - entryPrem) * lots * LOT_SIZE;
        const netPnl = grossPnl - lots * BROKERAGE_PER_LOT;

        trades.push({
          date: dk, strategy: strat, leg: 'AFTERNOON', tradeType: 'BUY_OPTION', direction: dir,
          entryTime: fiveBar.timestamp.toISOString(),
          exitTime: exitBar.timestamp.toISOString(),
          entryPremium: Math.round(entryPrem * 100) / 100,
          exitPremium: Math.round(exitPrem * 100) / 100,
          lots, lotSize: LOT_SIZE,
          grossPnl: Math.round(grossPnl), netPnl: Math.round(netPnl),
          exitReason, vix,
          meta: {
            spot: Math.round(spot),
            ema9: Math.round(emaVals.e9), ema21: Math.round(emaVals.e21),
            rsi: Math.round((rsiVal ?? 0) * 10) / 10,
            vwap: Math.round(vwapVal),
            stDir: curDir,
          },
        });
        traded = true;
      }
    }
    return trades;
  }

  // ── Strategy E: Combined (C1 morning + C2 afternoon) ──────────────────────

  private runE(
    sortedDays: string[],
    days5m: Map<string, any[]>,
    days15m: Map<string, any[]>,
    allBars15m: any[],
    getVix: (dk: string) => number,
    stDirByTs: Map<number, number>,
    ema5mByTs: Map<number, { e9: number; e21: number }>,
    rsi5mByTs: Map<number, number>,
  ): SEBTrade[] {
    const morningTrades = this.runC1(sortedDays, days5m, allBars15m /* unused */, getVix)
      .map(t => ({ ...t, strategy: 'E' as const, leg: 'MORNING' as const }));

    // Afternoon leg starts after 10:30 AM (let C1 clear first)
    const afternoonTrades = this.runSupertrendLeg(
      sortedDays, days5m, days15m, allBars15m, getVix,
      stDirByTs, ema5mByTs, rsi5mByTs, 1030, 1400, 'E',
    ).map(t => ({ ...t, strategy: 'E' as const, leg: 'AFTERNOON' as const }));

    return [...morningTrades, ...afternoonTrades].sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── Pure Sell Side All-Day ─────────────────────────────────────────────────

  private runPS(
    sortedDays: string[],
    days5m: Map<string, any[]>,
    days15m: Map<string, any[]>,
    allBars15m: any[],
    getVix: (dk: string) => number,
    stDirByTs: Map<number, number>,
  ): SEBTrade[] {
    const morningTrades = this.runC1(sortedDays, days5m, allBars15m /* unused */, getVix)
      .map(t => ({ ...t, strategy: 'PS' as const, leg: 'MORNING' as const }));

    const afternoonTrades: SEBTrade[] = [];

    for (const dk of sortedDays) {
      const bars5 = (days5m.get(dk) ?? []).sort((a, b) => a.timestamp - b.timestamp);
      if (bars5.length < 20) continue;

      const vix = getVix(dk);
      const sigma = vix / 100;
      const vwap = vwapSeries(bars5);
      const rsiVals = rsi(bars5.map(b => b.close), 14);
      let traded = false;

      for (let i = 14; i < bars5.length; i++) {
        if (traded) break;
        const b = bars5[i];
        const hhmm = istHHMM(b.timestamp);
        if (hhmm < 1030 || hhmm > 1400) continue;

        const vwapVal = vwap[i];
        const rsiVal = rsiVals[i];
        if (isNaN(rsiVal)) continue;

        const vwapDevPct = ((b.close - vwapVal) / vwapVal) * 100;

        // Entry: stretched > 0.7% from VWAP + RSI confirmation
        let spreadDir: 'bear-call' | 'bull-put' | null = null;
        if (vwapDevPct > 0.7 && rsiVal > 63) spreadDir = 'bear-call';
        else if (vwapDevPct < -0.7 && rsiVal < 37) spreadDir = 'bull-put';
        if (!spreadDir) continue;

        const spot = b.close;
        const tEntry = tFromTimestamp(b.timestamp);
        const entryCredit = creditSpread(spot, tEntry, sigma, spreadDir);
        if (entryCredit < 5) continue;

        const spreadWidth = 100;
        const maxRisk = (spreadWidth - entryCredit) * LOT_SIZE;
        const lots = Math.max(1, Math.floor(MAX_RISK / maxRisk));
        const tpCredit = entryCredit * 0.50; // keep 50% of credit
        const slLoss = entryCredit * 1.50;   // lose 150% of credit

        let exitBar = b;
        let exitCredit = entryCredit;
        let exitReason: 'TP' | 'SL' | 'TIME' = 'TIME';

        for (let j = i + 1; j < bars5.length; j++) {
          const nb = bars5[j];
          const nhhmm = istHHMM(nb.timestamp);
          if (nhhmm > 1430) { exitReason = 'TIME'; exitBar = nb; break; }

          const t = tFromTimestamp(nb.timestamp);
          const sv = creditSpread(nb.close, t, sigma, spreadDir);
          exitBar = nb;
          exitCredit = sv;

          // Seller profits when spread value drops
          const pnlPct = (entryCredit - sv) / entryCredit;
          if (pnlPct >= 0.50) { exitReason = 'TP'; break; }
          if (pnlPct <= -1.50) { exitReason = 'SL'; break; }
        }

        const grossPnl = (entryCredit - exitCredit) * lots * LOT_SIZE;
        const netPnl = grossPnl - lots * BROKERAGE_PER_LOT * 2;

        afternoonTrades.push({
          date: dk, strategy: 'PS', leg: 'AFTERNOON', tradeType: 'SELL_SPREAD',
          direction: spreadDir === 'bear-call' ? 'CALL' : 'PUT',
          entryTime: b.timestamp.toISOString(),
          exitTime: exitBar.timestamp.toISOString(),
          entryPremium: Math.round(entryCredit * 100) / 100,
          exitPremium: Math.round(exitCredit * 100) / 100,
          lots, lotSize: LOT_SIZE,
          grossPnl: Math.round(grossPnl), netPnl: Math.round(netPnl),
          exitReason, vix,
          meta: {
            spot: Math.round(spot), vwap: Math.round(vwapVal),
            vwapDevPct: Math.round(vwapDevPct * 100) / 100,
            rsi: Math.round(rsiVal * 10) / 10,
            spreadDir,
          },
        });
        traded = true;
      }
    }

    return [...morningTrades, ...afternoonTrades].sort((a, b) => a.date.localeCompare(b.date));
  }
}
