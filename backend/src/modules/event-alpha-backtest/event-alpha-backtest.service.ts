import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EventAlphaRun, EventAlphaRunDocument, EAStatus } from './schemas/event-alpha-backtest-run.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { OHLCV } from '../strategies/indicators';
import { bsPrice, istHHMM, istDayOfWeek, isNewDay } from '../strategies/option-indicators';

// ── Strategy D v1: Event Alpha (ATM Straddle on Event Days) ──────────────────
//
//  LOGIC:
//  Buy an ATM straddle (CALL + PUT at same strike) on days where a large move
//  is expected: RBI policy, Budget, elections, FOMC next-day effect, or any
//  day where VIX was elevated OR gap at open is large.
//
//  EDGE: On event days, the underlying makes a big directional move. The straddle
//  profits regardless of direction — you just need the move to exceed the
//  total premium paid (the straddle cost).
//
//  KEY DIFFERENCE from Strategies B & C: this BUYS premium. It profits on
//  BIG moves. It loses on flat days (theta + IV crush work against you).
//  Low frequency (1–3 trades per month) but high reward per trade.
//
//  EXIT:
//    • TP      — straddle value ≥ 1.5× entry (50% profit; needs ~2–3% move)
//    • SL      — straddle value ≤ 0.40× entry (60% loss; market stayed flat)
//    • TIME SL — exit at 1:30 PM if straddle < entry (event didn't move market)
//    • FORCE   — exit at 2:30 PM unconditionally

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 25, tickSize: 50,  expiryDow: 4 },
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 15, tickSize: 100, expiryDow: 3 },
] as const;

const RISK_FREE_RATE    = 0.07;
const MAX_RISK          = 5000;   // ₹5 000 max per event trade (higher than spread strategy)
const STRADDLE_TP       = 1.5;    // take profit at 1.5× entry straddle value
const STRADDLE_SL       = 0.40;   // stop loss at 40% of entry straddle value
const ENTRY_HHMM        = 920;    // 9:20 AM — second bar after open (gap absorbed)
const TIME_SL_HHMM      = 1330;   // 1:30 PM — cut if straddle still below entry
const FORCE_EXIT_HHMM   = 1430;   // 2:30 PM — always exit
const VIX_EVENT_LEVEL   = 18;     // if yesterday VIX > 18 → high-uncertainty day
const GAP_EVENT_PCT     = 0.012;  // if abs(gap) > 1.2% at open → event-like day
const MIN_T_DAYS        = 1.0;    // must have ≥1 day to expiry (skip own expiry days)
const BROKERAGE_PER_LOT = 80;     // two legs (call + put) per straddle

// Known high-impact event dates for 2023-2024 (hardcoded to ensure no miss)
const EVENT_DATES = new Set([
  // RBI MPC announcement days
  '2023-02-08', '2023-04-06', '2023-06-08', '2023-08-10', '2023-10-06', '2023-12-08',
  '2024-02-08', '2024-04-05', '2024-06-07', '2024-08-08', '2024-10-09', '2024-12-06',
  // Union Budget
  '2023-02-01', '2024-02-01',
  // Indian General Election results
  '2024-06-04',
  // FOMC next-day (Indian markets react morning after US Fed evening announcement)
  '2023-03-23', '2023-05-04', '2023-06-15', '2023-07-27', '2023-09-21', '2023-11-02', '2023-12-14',
  '2024-03-21', '2024-05-02', '2024-06-13', '2024-08-01', '2024-09-19', '2024-11-08', '2024-12-19',
]);

interface EATrade {
  symbol: string;
  eventType: string;
  entryTime: string;
  exitTime: string;
  strike: number;
  entryStraddle: number;
  exitStraddle: number;
  lots: number;
  lotSize: number;
  grossPnl: number;
  netPnl: number;
  exitReason: 'TP' | 'SL' | 'TIME_SL' | 'EOD';
  vix: number;
  gapPct: number;
  meta: Record<string, number | string>;
}

interface OpenEATrade {
  strike: number;
  entryStraddle: number;
  entryTime: Date;
  lots: number;
  vix: number;
  gapPct: number;
  eventType: string;
  meta: Record<string, number | string>;
}

function mean(a: number[]) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stdDev(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function computeMetrics(trades: EATrade[], init: number) {
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
export class EventAlphaBacktestService {
  private readonly logger = new Logger(EventAlphaBacktestService.name);

  constructor(
    @InjectModel(EventAlphaRun.name) private runModel: Model<EventAlphaRunDocument>,
    private marketData: MarketDataService,
  ) {}

  async run(userId: string, fromDate: string, toDate: string) {
    const record = await this.runModel.create({ userId: new Types.ObjectId(userId), fromDate: new Date(fromDate), toDate: new Date(toDate), status: EAStatus.QUEUED });
    void this.execute(record._id.toString(), fromDate, toDate);
    return record;
  }

  async get(id: string) { return this.runModel.findById(id); }

  async list(userId: string) {
    return this.runModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(20).select('-trades');
  }

  async simulateTrades(fromDate: string, toDate: string): Promise<(EATrade & { _strategy: 'EVENT' })[]> {
    const from = new Date(fromDate), to = new Date(toDate);
    const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
    const vixMap = new Map<string, number>();
    for (const v of vixBars) vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);
    const all: EATrade[] = [];
    for (const inst of INSTRUMENTS) all.push(...await this.simulateInstrument(inst, from, to, vixMap));
    return all.map(t => ({ ...t, _strategy: 'EVENT' as const }));
  }

  private async execute(runId: string, fromDate: string, toDate: string) {
    await this.runModel.findByIdAndUpdate(runId, { status: EAStatus.RUNNING });
    try {
      const from = new Date(fromDate), to = new Date(toDate);
      const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
      const vixMap = new Map<string, number>();
      for (const v of vixBars) vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);

      const allTrades: EATrade[] = [];
      for (const inst of INSTRUMENTS) {
        const trades = await this.simulateInstrument(inst, from, to, vixMap);
        allTrades.push(...trades);
        this.logger.log(`EventAlpha ${inst.symbol}: ${trades.length} trades`);
      }
      allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));

      let equity = 1_000_000;
      const equityCurve: { t: string; e: number }[] = [];
      for (const t of [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) {
        equity += t.netPnl;
        equityCurve.push({ t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) });
      }

      await this.runModel.findByIdAndUpdate(runId, {
        status: EAStatus.COMPLETED,
        metrics: { ...computeMetrics(allTrades, 1_000_000), equityCurve },
        trades: allTrades,
      });
    } catch (err: any) {
      this.logger.error(`EventAlpha ${runId} failed: ${err.message}`);
      await this.runModel.findByIdAndUpdate(runId, { status: EAStatus.FAILED, errorMessage: err.message });
    }
  }

  private async simulateInstrument(
    inst: typeof INSTRUMENTS[number],
    from: Date,
    to: Date,
    vixMap: Map<string, number>,
  ): Promise<EATrade[]> {
    const lookback = new Date(from);
    lookback.setMonth(lookback.getMonth() - 1);
    const bars5 = await this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookback, to);
    if (bars5.length < 50) return [];

    const trades: EATrade[] = [];
    let prevBar: typeof bars5[0] | null = null;
    let prevDayClose = 0;
    let tradedToday = false;
    let openTrade: OpenEATrade | null = null;
    let prevVix = 15;

    for (const bar of bars5) {
      const barDate = bar.timestamp;
      const hhmm = istHHMM(barDate);
      const dow  = istDayOfWeek(barDate);

      // ── Day reset ─────────────────────────────────────────────────────────
      if (!prevBar || isNewDay(prevBar.timestamp, barDate)) {
        if (openTrade && prevBar) {
          const sv = this.straddleValue(prevBar.close, openTrade.strike, barDate, inst.expiryDow, openTrade.vix);
          trades.push(this.mkTrade(inst, openTrade, sv, prevBar.timestamp, 'EOD'));
          openTrade = null;
        }
        if (prevBar) {
          prevDayClose = prevBar.close;
          const prevDate = prevBar.timestamp.toISOString().slice(0, 10);
          prevVix = vixMap.get(prevDate) ?? prevVix;
        }
        tradedToday = false;
      }
      prevBar = bar;

      if (barDate < from) continue;
      if (dow === 0 || dow === 5 || dow === 6) continue;

      // ── Manage open trade ─────────────────────────────────────────────────
      if (openTrade) {
        const sv = this.straddleValue(bar.close, openTrade.strike, barDate, inst.expiryDow, openTrade.vix);

        if (sv >= openTrade.entryStraddle * STRADDLE_TP) {
          trades.push(this.mkTrade(inst, openTrade, sv, barDate, 'TP'));
          openTrade = null; continue;
        }
        if (sv <= openTrade.entryStraddle * STRADDLE_SL) {
          trades.push(this.mkTrade(inst, openTrade, sv, barDate, 'SL'));
          openTrade = null; continue;
        }
        // Time SL: at 1:30 PM if straddle is below entry (event didn't play out)
        if (hhmm >= TIME_SL_HHMM && sv < openTrade.entryStraddle) {
          trades.push(this.mkTrade(inst, openTrade, sv, barDate, 'TIME_SL'));
          openTrade = null; continue;
        }
        if (hhmm >= FORCE_EXIT_HHMM) {
          trades.push(this.mkTrade(inst, openTrade, sv, barDate, 'EOD'));
          openTrade = null; continue;
        }
        continue;
      }

      // ── Entry: only at 9:20 AM, only on event days, once per day ─────────
      if (tradedToday || hhmm !== ENTRY_HHMM) continue;

      const vix = vixMap.get(barDate.toISOString().slice(0, 10)) ?? prevVix;
      const gapPct = prevDayClose > 0 ? (bar.open - prevDayClose) / prevDayClose : 0;
      const dateStr = barDate.toISOString().slice(0, 10);

      // Is today an event day?
      const isHardcoded = EVENT_DATES.has(dateStr);
      const isVixEvent  = prevVix > VIX_EVENT_LEVEL;
      const isGapEvent  = Math.abs(gapPct) > GAP_EVENT_PCT;

      if (!isHardcoded && !isVixEvent && !isGapEvent) continue;

      // Skip if today is the expiry day for this instrument (T < MIN_T_DAYS)
      const T = this.tte(barDate, inst.expiryDow);
      if (T < MIN_T_DAYS / 365) continue;

      const S = bar.close;
      const K = Math.round(S / inst.tickSize) * inst.tickSize; // nearest ATM strike
      const sv = this.straddleValue(S, K, barDate, inst.expiryDow, vix);

      if (sv < 30) continue; // straddle too cheap — not worth trading

      const maxLossPerLot = sv * (1 - STRADDLE_SL) * inst.lotSize;
      const lots = Math.max(1, Math.floor(MAX_RISK / maxLossPerLot));

      const eventType = isHardcoded ? 'HARDCODED' : isVixEvent ? 'VIX_SPIKE' : 'GAP';

      tradedToday = true;
      openTrade = {
        strike: K,
        entryStraddle: +sv.toFixed(2),
        entryTime: barDate,
        lots,
        vix,
        gapPct: +gapPct.toFixed(4),
        eventType,
        meta: {
          spot: +S.toFixed(2), strike: K, vix: +vix.toFixed(1),
          prevVix: +prevVix.toFixed(1), gapPct: +(gapPct * 100).toFixed(2),
          T_days: +(T * 365).toFixed(1), eventType,
          callEntry: +bsPrice(S, K, RISK_FREE_RATE, T, vix / 100, 'call').toFixed(2),
          putEntry:  +bsPrice(S, K, RISK_FREE_RATE, T, vix / 100, 'put').toFixed(2),
        },
      };
    }

    return trades;
  }

  private straddleValue(spot: number, strike: number, date: Date, expiryDow: number, vix: number): number {
    const T  = this.tte(date, expiryDow);
    const iv = vix / 100;
    const call = bsPrice(spot, strike, RISK_FREE_RATE, T, iv, 'call');
    const put  = bsPrice(spot, strike, RISK_FREE_RATE, T, iv, 'put');
    return +(call + put).toFixed(2);
  }

  private mkTrade(inst: typeof INSTRUMENTS[number], t: OpenEATrade, exitSV: number, exitTime: Date, reason: EATrade['exitReason']): EATrade {
    const gp = (exitSV - t.entryStraddle) * t.lots * inst.lotSize;
    return {
      symbol: inst.symbol,
      eventType: t.eventType,
      entryTime: t.entryTime.toISOString(),
      exitTime: exitTime.toISOString(),
      strike: t.strike,
      entryStraddle: t.entryStraddle,
      exitStraddle: +exitSV.toFixed(2),
      lots: t.lots,
      lotSize: inst.lotSize,
      grossPnl: +gp.toFixed(2),
      netPnl: +(gp - BROKERAGE_PER_LOT * t.lots).toFixed(2),
      exitReason: reason,
      vix: t.vix,
      gapPct: t.gapPct,
      meta: t.meta,
    };
  }

  // ── Time to weekly expiry for given instrument (expiryDow: 4=Thu, 3=Wed) ─
  private tte(date: Date, expiryDow: number): number {
    const ist = new Date(date.getTime() + 5.5 * 3_600_000);
    const dow = ist.getUTCDay();
    const daysToExpiry = ((expiryDow - dow + 7) % 7) || 7;
    const hoursLeft = 15.5 - (ist.getUTCHours() + ist.getUTCMinutes() / 60);
    return Math.max((daysToExpiry - 1 + hoursLeft / 6.25) / 365, 1 / 365);
  }
}
