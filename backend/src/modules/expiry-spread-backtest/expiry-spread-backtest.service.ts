import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ExpirySpreadRun, ExpirySpreadRunDocument, ESStatus } from './schemas/expiry-spread-backtest-run.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { ema, OHLCV } from '../strategies/indicators';
import { bsPrice, istHHMM, istDayOfWeek, isNewDay } from '../strategies/option-indicators';

// ── Strategy C v1: Expiry Day Spread Selling ─────────────────────────────────
//
//  LOGIC:
//  On NIFTY expiry (Thursday) and BankNifty expiry (Wednesday):
//    • At 10:30 AM read EMA9/21 bias
//    • BULLISH → sell Bull Put Spread (profit if market stays above short strike)
//    • BEARISH → sell Bear Call Spread (profit if market stays below short strike)
//    • NEUTRAL → sell Iron Condor (profit from range-bound decay)
//
//  EDGE: ~85% of options expire worthless on expiry day; theta burns fastest
//  in the last few hours. Defined-risk spreads cap the downside.
//
//  EXIT:
//    • TP  — when spread value decays to ≤30% of entry premium (70% profit captured)
//    • SL  — when underlying crosses the short strike (momentum SL)
//    • EOD — forced exit at 3:15 PM IST

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 25, tickSize: 50,  expiryDow: 4 }, // Thursday
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 15, tickSize: 100, expiryDow: 3 }, // Wednesday
] as const;

const RISK_FREE_RATE     = 0.07;
const MAX_RISK_PER_TRADE = 2000;   // ₹2 000 max loss per trade (defined-risk spread)
const EXPIRY_IV_MULT     = 2.2;    // expiry day near-term IV ≈ 2.2× VIX (theta is very high)
const ENTRY_HHMM         = 1030;   // enter at exactly 10:30 AM bar
const EXIT_HHMM          = 1515;   // force exit 3:15 PM (15 min before expiry settlement)
const TP_DECAY           = 0.30;   // close when spread value ≤ 30% of entry net premium
const SL_PREMIUM_MULT    = 2.5;    // v2: exit when cost-to-close ≥ 2.5× entry premium (was: strike cross)
const VIX_MAX            = 25;     // skip selling when market is too volatile
const NEUTRAL_EMA_PCT    = 0.0005; // within 0.05% → treat as neutral → Iron Condor
const EMA_FAST           = 9;
const EMA_SLOW           = 21;
const BROKERAGE_PER_LOT  = 40;

type SpreadDir = 'BULL_PUT' | 'BEAR_CALL' | 'IRON_CONDOR';

interface ESTrade {
  symbol: string;
  direction: SpreadDir;
  entryTime: string;
  exitTime: string;
  shortPutStrike: number | null;
  longPutStrike: number | null;
  shortCallStrike: number | null;
  longCallStrike: number | null;
  entryPremiumNet: number;
  exitPremiumNet: number;
  spreadWidth: number;
  lots: number;
  lotSize: number;
  grossPnl: number;
  netPnl: number;
  exitReason: 'TP' | 'SL' | 'EOD';
  vix: number;
  meta: Record<string, number | string>;
}

interface OpenESTrade {
  direction: SpreadDir;
  shortPutStrike: number | null;
  longPutStrike: number | null;
  shortCallStrike: number | null;
  longCallStrike: number | null;
  entryPremiumNet: number;
  entryTime: Date;
  lots: number;
  spreadWidth: number;
  vix: number;
  meta: Record<string, number | string>;
}

function mean(a: number[]) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stdDev(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function computeMetrics(trades: ESTrade[], init: number) {
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
export class ExpirySpreadBacktestService {
  private readonly logger = new Logger(ExpirySpreadBacktestService.name);

  constructor(
    @InjectModel(ExpirySpreadRun.name) private runModel: Model<ExpirySpreadRunDocument>,
    private marketData: MarketDataService,
  ) {}

  async run(userId: string, fromDate: string, toDate: string) {
    const record = await this.runModel.create({ userId: new Types.ObjectId(userId), fromDate: new Date(fromDate), toDate: new Date(toDate), status: ESStatus.QUEUED });
    void this.execute(record._id.toString(), fromDate, toDate);
    return record;
  }

  async get(id: string) { return this.runModel.findById(id); }

  async list(userId: string) {
    return this.runModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(20).select('-trades');
  }

  async simulateTrades(fromDate: string, toDate: string): Promise<(ESTrade & { _strategy: 'SPREAD' })[]> {
    const from = new Date(fromDate), to = new Date(toDate);
    const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
    const vixMap = new Map<string, number>();
    for (const v of vixBars) vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);
    const all: ESTrade[] = [];
    for (const inst of INSTRUMENTS) all.push(...await this.simulateInstrument(inst, from, to, vixMap));
    return all.map(t => ({ ...t, _strategy: 'SPREAD' as const }));
  }

  private async execute(runId: string, fromDate: string, toDate: string) {
    await this.runModel.findByIdAndUpdate(runId, { status: ESStatus.RUNNING });
    try {
      const from = new Date(fromDate), to = new Date(toDate);
      const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', from, to);
      const vixMap = new Map<string, number>();
      for (const v of vixBars) vixMap.set(v.timestamp.toISOString().slice(0, 10), v.close);

      const allTrades: ESTrade[] = [];
      for (const inst of INSTRUMENTS) {
        const trades = await this.simulateInstrument(inst, from, to, vixMap);
        allTrades.push(...trades);
        this.logger.log(`ExpirySpread ${inst.symbol}: ${trades.length} trades`);
      }
      allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));

      let equity = 1_000_000;
      const equityCurve: { t: string; e: number }[] = [];
      for (const t of [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) {
        equity += t.netPnl;
        equityCurve.push({ t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) });
      }

      await this.runModel.findByIdAndUpdate(runId, {
        status: ESStatus.COMPLETED,
        metrics: { ...computeMetrics(allTrades, 1_000_000), equityCurve },
        trades: allTrades,
      });
    } catch (err: any) {
      this.logger.error(`ExpirySpread ${runId} failed: ${err.message}`);
      await this.runModel.findByIdAndUpdate(runId, { status: ESStatus.FAILED, errorMessage: err.message });
    }
  }

  private async simulateInstrument(
    inst: typeof INSTRUMENTS[number],
    from: Date,
    to: Date,
    vixMap: Map<string, number>,
  ): Promise<ESTrade[]> {
    const lookback = new Date(from);
    lookback.setMonth(lookback.getMonth() - 1);
    const bars5 = await this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookback, to);
    if (bars5.length < 50) return [];

    const trades: ESTrade[] = [];
    const rolling: OHLCV[] = [];
    let prevBar: typeof bars5[0] | null = null;
    let sessionBars: OHLCV[] = [];
    let tradedToday = false;
    let openTrade: OpenESTrade | null = null;

    for (const bar of bars5) {
      const barDate = bar.timestamp;
      const hhmm = istHHMM(barDate);
      const dow  = istDayOfWeek(barDate);
      const ohlcv: OHLCV = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };

      // Day reset
      if (!prevBar || isNewDay(prevBar.timestamp, barDate)) {
        if (openTrade && prevBar) {
          const exitPrem = this.currentSpreadValue(openTrade, prevBar.close, prevBar.timestamp);
          trades.push(this.mkTrade(inst, openTrade, exitPrem, prevBar.timestamp, 'EOD'));
          openTrade = null;
        }
        sessionBars = [];
        tradedToday = false;
      }
      prevBar = bar;
      rolling.push(ohlcv);
      if (rolling.length > 200) rolling.shift();

      if (barDate < from) { sessionBars.push(ohlcv); continue; }
      if (dow === 0 || dow === 5 || dow === 6) continue;

      // Only act on expiry day for this instrument
      const isExpiryDay = dow === inst.expiryDow;

      if (isExpiryDay) sessionBars.push(ohlcv);

      // ── Manage open position ─────────────────────────────────────────────────
      if (openTrade) {
        const T = this.tteExpiry(barDate);
        const currentVal = this.currentSpreadValue(openTrade, bar.close, barDate);
        const tp = openTrade.entryPremiumNet * TP_DECAY;

        // TP: spread decayed to target
        if (currentVal <= tp) {
          trades.push(this.mkTrade(inst, openTrade, currentVal, barDate, 'TP'));
          openTrade = null; continue;
        }

        // SL: cost-to-close ≥ 2.5× entry premium (gives the spread breathing room vs v1 strike-cross)
        if (currentVal >= openTrade.entryPremiumNet * SL_PREMIUM_MULT) {
          trades.push(this.mkTrade(inst, openTrade, currentVal, barDate, 'SL'));
          openTrade = null; continue;
        }

        // EOD force exit
        if (hhmm >= EXIT_HHMM) {
          const eodPrem = this.currentSpreadValue(openTrade, bar.close, barDate);
          trades.push(this.mkTrade(inst, openTrade, eodPrem, barDate, 'EOD'));
          openTrade = null; continue;
        }
        continue;
      }

      // ── Entry: only on expiry day at 10:30 AM, one trade per day ─────────────
      if (!isExpiryDay || tradedToday || hhmm !== ENTRY_HHMM) continue;

      const vix = vixMap.get(barDate.toISOString().slice(0, 10)) ?? 15;
      if (vix > VIX_MAX) continue; // too volatile to sell premium
      if (rolling.length < EMA_SLOW + 5) continue;

      const closes = rolling.map(b => b.close);
      const ema9arr = ema(closes, EMA_FAST);
      const ema21arr = ema(closes, EMA_SLOW);
      const ema9 = ema9arr[ema9arr.length - 1];
      const ema21 = ema21arr[ema21arr.length - 1];
      if (!ema9 || !ema21) continue;

      const emaDiff = (ema9 - ema21) / ema21;
      const S = bar.close;
      const iv = (vix / 100) * EXPIRY_IV_MULT;
      const T = this.tteExpiry(barDate);

      let direction: SpreadDir;
      let shortPutStrike: number | null = null, longPutStrike: number | null = null;
      let shortCallStrike: number | null = null, longCallStrike: number | null = null;
      let netPremium = 0;

      if (emaDiff > NEUTRAL_EMA_PCT) {
        // Bullish → Bull Put Spread
        direction = 'BULL_PUT';
        shortPutStrike = Math.floor(S / inst.tickSize) * inst.tickSize;
        longPutStrike  = shortPutStrike - inst.tickSize;
        const shortP = bsPrice(S, shortPutStrike, RISK_FREE_RATE, T, iv, 'put');
        const longP  = bsPrice(S, longPutStrike,  RISK_FREE_RATE, T, iv, 'put');
        netPremium = shortP - longP;
      } else if (emaDiff < -NEUTRAL_EMA_PCT) {
        // Bearish → Bear Call Spread
        direction = 'BEAR_CALL';
        shortCallStrike = Math.ceil(S / inst.tickSize) * inst.tickSize;
        longCallStrike  = shortCallStrike + inst.tickSize;
        const shortC = bsPrice(S, shortCallStrike, RISK_FREE_RATE, T, iv, 'call');
        const longC  = bsPrice(S, longCallStrike,  RISK_FREE_RATE, T, iv, 'call');
        netPremium = shortC - longC;
      } else {
        // Neutral → Iron Condor (sell both spreads)
        direction = 'IRON_CONDOR';
        shortPutStrike  = Math.floor(S / inst.tickSize) * inst.tickSize;
        longPutStrike   = shortPutStrike - inst.tickSize;
        shortCallStrike = Math.ceil(S / inst.tickSize) * inst.tickSize;
        longCallStrike  = shortCallStrike + inst.tickSize;
        if (shortCallStrike === shortPutStrike) shortCallStrike += inst.tickSize; // ensure different strikes
        const shortP = bsPrice(S, shortPutStrike,  RISK_FREE_RATE, T, iv, 'put');
        const longP  = bsPrice(S, longPutStrike,   RISK_FREE_RATE, T, iv, 'put');
        const shortC = bsPrice(S, shortCallStrike, RISK_FREE_RATE, T, iv, 'call');
        const longC  = bsPrice(S, longCallStrike,  RISK_FREE_RATE, T, iv, 'call');
        netPremium = (shortP - longP) + (shortC - longC);
      }

      if (netPremium < 5) continue; // min viable premium

      const spreadWidth = inst.tickSize; // width of one individual spread
      const maxLossPerLot = Math.max(1, (spreadWidth - (direction === 'IRON_CONDOR' ? netPremium / 2 : netPremium)) * inst.lotSize);
      const lots = Math.min(4, Math.max(1, Math.floor(MAX_RISK_PER_TRADE / maxLossPerLot)));

      tradedToday = true;
      openTrade = {
        direction,
        shortPutStrike,  longPutStrike,
        shortCallStrike, longCallStrike,
        entryPremiumNet: +netPremium.toFixed(2),
        entryTime: barDate,
        lots,
        spreadWidth,
        vix,
        meta: {
          spot: +S.toFixed(2), ema9: +ema9.toFixed(2), ema21: +ema21.toFixed(2),
          emaDiffPct: +(emaDiff * 100).toFixed(3), iv: +(iv * 100).toFixed(1),
          shortPutStrike: shortPutStrike ?? 0, longPutStrike: longPutStrike ?? 0,
          shortCallStrike: shortCallStrike ?? 0, longCallStrike: longCallStrike ?? 0,
          tHours: +(T * 365 * 24).toFixed(2),
        },
      };
    }

    return trades;
  }

  // ── Current spread value (cost to close the spread now) ───────────────────
  private currentSpreadValue(trade: OpenESTrade, spot: number, date: Date): number {
    const T  = this.tteExpiry(date);
    const iv = (trade.vix / 100) * EXPIRY_IV_MULT;
    let val  = 0;

    if (trade.shortPutStrike && trade.longPutStrike) {
      const sp = bsPrice(spot, trade.shortPutStrike, RISK_FREE_RATE, T, iv, 'put');
      const lp = bsPrice(spot, trade.longPutStrike,  RISK_FREE_RATE, T, iv, 'put');
      val += Math.max(0, sp - lp);
    }
    if (trade.shortCallStrike && trade.longCallStrike) {
      const sc = bsPrice(spot, trade.shortCallStrike, RISK_FREE_RATE, T, iv, 'call');
      const lc = bsPrice(spot, trade.longCallStrike,  RISK_FREE_RATE, T, iv, 'call');
      val += Math.max(0, sc - lc);
    }
    return +val.toFixed(2);
  }

  private mkTrade(inst: typeof INSTRUMENTS[number], t: OpenESTrade, exitPremNet: number, exitTime: Date, reason: ESTrade['exitReason']): ESTrade {
    const gp = (t.entryPremiumNet - exitPremNet) * t.lots * inst.lotSize;
    return {
      symbol: inst.symbol,
      direction: t.direction,
      entryTime: t.entryTime.toISOString(),
      exitTime: exitTime.toISOString(),
      shortPutStrike: t.shortPutStrike,
      longPutStrike: t.longPutStrike,
      shortCallStrike: t.shortCallStrike,
      longCallStrike: t.longCallStrike,
      entryPremiumNet: t.entryPremiumNet,
      exitPremiumNet: +exitPremNet.toFixed(2),
      spreadWidth: t.spreadWidth,
      lots: t.lots,
      lotSize: inst.lotSize,
      grossPnl: +gp.toFixed(2),
      netPnl: +(gp - BROKERAGE_PER_LOT * t.lots).toFixed(2),
      exitReason: reason,
      vix: t.vix,
      meta: t.meta,
    };
  }

  // ── Time to expiry: hours remaining until 3:30 PM IST same day ───────────
  private tteExpiry(date: Date): number {
    const ist = new Date(date.getTime() + 5.5 * 3_600_000);
    const hIST = ist.getUTCHours() + ist.getUTCMinutes() / 60;
    const hoursLeft = Math.max(1 / 60, 15.5 - hIST); // 15.5 = 3:30 PM, min 1 minute
    return hoursLeft / (365 * 24);
  }
}
