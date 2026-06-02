import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { CryptoTrade, CryptoTradeDocument } from './schemas/crypto-trade.schema';
import { BinanceAdapter, BinanceKline } from './binance.adapter';
import { ema, rsi, adx, atr, OHLCV } from '../strategies/indicators';
import { calcVWAP, calcSupertrend, calcORB } from '../strategies/option-indicators';

// ── Strategy B v4 adapted for 24/7 crypto (no options, direct spot/futures) ──
//
//  Session  = UTC calendar day (00:00 → 23:00 UTC)
//  ORB      = first 9 bars of session (9 × 5min = 45-min opening range)
//  Entry    = 00:45 UTC → 20:00 UTC  (20-hour window → far more signals/day)
//  EOD exit = 23:00 UTC
//  P&L      = (exitPrice - entryPrice) × qty × ±1 (no options premium)
//  Capital  = $200 USDT paper, $20 max risk per trade

const INSTRUMENTS = [
  { symbol: 'BTCUSDT', tickSize: 100 },
  { symbol: 'ETHUSDT', tickSize: 10  },
] as const;

const STARTING_CAPITAL   = 200;     // USDT
const MAX_RISK_USDT      = 20;      // per trade ($20 = 10% of $200)
const SL_PCT             = 0.012;   // 1.2% initial SL (replaces ATR-based for simplicity)
const TRAIL_PCT          = 0.20;    // 20% trail from peak — same as NIFTY strategy
const PARTIAL_MULT       = 1.8;     // partial TP at 1.8× initial move
const ORB_BARS           = 9;       // 45-min ORB
const ENTRY_FROM_MIN     = 45;      // 00:45 UTC — after ORB forms
const ENTRY_TO_MIN       = 1200;    // 20:00 UTC
const EXIT_MIN           = 1380;    // 23:00 UTC — EOD
const COOLDOWN_MS        = 20 * 60 * 1000;
const MAX_TRADES_PER_DAY = 4;
const VOL_SURGE          = 1.5;
const VOL_AVG_BARS       = 20;
const RSI_BULL           = 60;
const RSI_BEAR           = 40;
const ADX_MIN            = 20;
const EMA_FAST           = 9;
const EMA_SLOW           = 21;
const RSI_PERIOD         = 14;
const ST_PERIOD          = 10;
const ST_MULT            = 3;

function toOHLCV(b: BinanceKline): OHLCV {
  return { open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
}

@Injectable()
export class CryptoOrbService {
  private readonly logger = new Logger(CryptoOrbService.name);

  constructor(
    @InjectModel(CryptoTrade.name) private tradeModel: Model<CryptoTradeDocument>,
    private binance: BinanceAdapter,
  ) {}

  // ── Fires every 5 min, 24/7 ──────────────────────────────────────────────
  @Cron('*/5 * * * *')
  async tick() {
    for (const inst of INSTRUMENTS) {
      try {
        await this.processInstrument(inst);
      } catch (err) {
        this.logger.error(`${inst.symbol} tick error: ${err}`);
      }
    }
  }

  // ── Per-instrument logic ──────────────────────────────────────────────────

  private async processInstrument(inst: typeof INSTRUMENTS[number]) {
    const now = new Date();
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const todayKey = now.toISOString().slice(0, 10); // "2024-06-02"
    const todayStartMs = new Date(todayKey + 'T00:00:00Z').getTime();

    // ── Fetch bars from Binance ──────────────────────────────────────────────
    const [raw5, raw15] = await Promise.all([
      this.binance.getRolling(inst.symbol, '5m', 200),
      this.binance.getRolling(inst.symbol, '15m', 150),
    ]);
    if (raw5.length < 50) return;

    const rollingBars = raw5.map(toOHLCV);
    const rolling15   = raw15.map(toOHLCV);

    // Today's session bars (UTC day boundary)
    const sessionRaw  = raw5.filter(b => b.openTimeMs >= todayStartMs);
    const sessionBars = sessionRaw.map(toOHLCV);

    if (sessionBars.length < 2) return;

    const last = rollingBars[rollingBars.length - 1];

    // ── ORB: needs first 9 session bars ──────────────────────────────────────
    if (sessionBars.length < ORB_BARS || utcMin < ENTRY_FROM_MIN) {
      this.logger.debug(`${inst.symbol}: waiting for ORB (${sessionBars.length}/${ORB_BARS} bars, utcMin ${utcMin})`);
      return;
    }
    const orb = calcORB(sessionBars, ORB_BARS);

    // ── Manage open trade ────────────────────────────────────────────────────
    const open = await this.tradeModel.findOne({ symbol: inst.symbol, status: 'OPEN' });
    if (open) {
      const cp = last.close;
      const newPeak = open.direction === 'LONG'
        ? Math.max(open.peakPrice ?? open.entryPrice, cp)
        : Math.min(open.peakPrice ?? open.entryPrice, cp); // for SHORT, peak = min price

      // Trailing SL: for LONG, SL rises with peak; for SHORT, SL falls with peak
      let contTrailSL: number;
      if (open.direction === 'LONG') {
        contTrailSL = +(newPeak * (1 - TRAIL_PCT)).toFixed(2);
      } else {
        contTrailSL = +(newPeak * (1 + TRAIL_PCT)).toFixed(2);
      }

      const newSL = open.direction === 'LONG'
        ? Math.max(open.slPrice, contTrailSL)
        : Math.min(open.slPrice, contTrailSL);
      const nowTrail = (open.direction === 'LONG' ? newSL > open.slPrice : newSL < open.slPrice) || open.trailSL;

      // Partial at 1.8× move
      const move = open.direction === 'LONG'
        ? (cp - open.entryPrice) / open.entryPrice
        : (open.entryPrice - cp) / open.entryPrice;
      const partialNow = open.partialBooked || move >= (PARTIAL_MULT - 1) * SL_PCT / SL_PCT * 0.02;
      let newQty = open.quantity;
      if (!open.partialBooked && move >= 0.018) { // ~1.8× of 1% initial move
        newQty = +(open.quantity / 2).toFixed(8);
        this.logger.log(`${inst.symbol}: partial booking at $${cp} — qty ${open.quantity} → ${newQty}`);
      }

      await this.tradeModel.findByIdAndUpdate(open._id, {
        peakPrice: newPeak, slPrice: newSL, trailSL: nowTrail,
        quantity: newQty, partialBooked: partialNow,
      });

      const slHit = open.direction === 'LONG' ? cp <= newSL : cp >= newSL;
      const eod   = utcMin >= EXIT_MIN;

      if (slHit || eod) {
        const exitReason = eod ? 'EOD' : (nowTrail ? 'TRAIL_SL' : 'SL');
        const pnl = open.direction === 'LONG'
          ? +(( cp - open.entryPrice) * newQty).toFixed(4)
          : +((open.entryPrice -  cp) * newQty).toFixed(4);
        const capBefore = await this.getCurrentCapital(open._id.toString());
        await this.tradeModel.findByIdAndUpdate(open._id, {
          status: 'CLOSED', exitPrice: cp, exitTime: now, exitReason,
          netPnlUsdt: pnl, capitalBefore: capBefore, capitalAfter: +(capBefore + pnl).toFixed(4),
        });
        this.logger.log(`CLOSED ${inst.symbol} ${open.direction} @ $${cp} | P&L $${pnl} | ${exitReason}`);
      } else {
        this.logger.log(`${inst.symbol} open: price $${cp} peak $${newPeak} SL $${newSL} trail=${nowTrail}`);
      }
      return;
    }

    // ── Entry check ───────────────────────────────────────────────────────────
    if (utcMin < ENTRY_FROM_MIN || utcMin > ENTRY_TO_MIN) return;

    // Max trades per session
    const todayStart = new Date(todayKey + 'T00:00:00Z');
    const sessionTrades = await this.tradeModel.find({
      symbol: inst.symbol, entryTime: { $gte: todayStart },
    });
    if (sessionTrades.length >= MAX_TRADES_PER_DAY) return;

    // Cooldown
    const closedToday = sessionTrades.filter(t => t.status === 'CLOSED' && t.exitTime);
    if (closedToday.length > 0) {
      const lastExit = closedToday.sort((a, b) =>
        new Date(b.exitTime!).getTime() - new Date(a.exitTime!).getTime())[0].exitTime!;
      if (now.getTime() - new Date(lastExit).getTime() < COOLDOWN_MS) return;
    }

    if (rollingBars.length < Math.max(EMA_SLOW, RSI_PERIOD, ST_PERIOD * 2) + 5) return;

    // ── Indicators ────────────────────────────────────────────────────────────
    const rc   = rollingBars.map(b => b.close);
    const efArr = ema(rc, EMA_FAST), esArr = ema(rc, EMA_SLOW), rvArr = rsi(rc, RSI_PERIOD);
    const st   = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT);
    const vw   = calcVWAP(sessionBars);
    const efN  = efArr[efArr.length - 1], esN = esArr[esArr.length - 1];
    const rsiV = rvArr[rvArr.length - 1], vwV = vw[vw.length - 1];
    const tN   = st.trend[st.trend.length - 1];
    if (!efN || !esN || !rsiV || !vwV || tN === 0) return;

    // ADX filter
    const adxVal = adx(rollingBars, 14);
    if (adxVal < ADX_MIN) {
      this.logger.log(`${inst.symbol}: ADX ${adxVal.toFixed(1)} < ${ADX_MIN} — skip`);
      return;
    }

    const callOk = last.close > orb.high && tN === 1  && efN > esN && last.close > vwV && rsiV > RSI_BULL;
    const putOk  = last.close < orb.low  && tN === -1 && efN < esN && last.close < vwV && rsiV < RSI_BEAR;
    if (!callOk && !putOk) {
      this.logger.log(`${inst.symbol} @ utcMin${utcMin}: no signal. price=$${last.close} orbH=$${orb.high.toFixed(0)} orbL=$${orb.low.toFixed(0)} ema=${efN.toFixed(0)}/${esN.toFixed(0)} rsi=${rsiV.toFixed(1)} st=${tN}`);
      return;
    }

    // Volume surge
    const recentVols = rollingBars.slice(-VOL_AVG_BARS).map(b => b.volume);
    const volAvg = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
    if (volAvg > 0 && last.volume < volAvg * VOL_SURGE) {
      this.logger.log(`${inst.symbol}: volume surge failed`);
      return;
    }

    // 15-min MTF EMA
    if (rolling15.length >= EMA_SLOW + 5) {
      const c15 = rolling15.map(b => b.close);
      const ef15 = ema(c15, EMA_FAST), es15 = ema(c15, EMA_SLOW);
      const ef15N = ef15[ef15.length - 1], es15N = es15[es15.length - 1];
      if (ef15N && es15N) {
        if (callOk && ef15N <= es15N) return;
        if (putOk  && ef15N >= es15N) return;
      }
    }

    // ATR-based dynamic SL
    const atrArr = atr(rollingBars, 14);
    const atrVal = atrArr[atrArr.length - 1] ?? 0;
    const atrPct = atrVal > 0 ? Math.min(atrVal / last.close, 0.05) : SL_PCT;
    const dynSlPct = Math.max(0.005, Math.min(SL_PCT, atrPct * 0.8));

    const dir: 'LONG' | 'SHORT' = callOk ? 'LONG' : 'SHORT';
    const slPrice = dir === 'LONG'
      ? +(last.close * (1 - dynSlPct)).toFixed(2)
      : +(last.close * (1 + dynSlPct)).toFixed(2);

    // Position sizing: risk $20 max
    const riskPerUnit = Math.abs(last.close - slPrice);
    const qty = +(MAX_RISK_USDT / riskPerUnit).toFixed(6);

    const capNow = await this.getCurrentCapital();

    await this.tradeModel.create({
      symbol: inst.symbol, direction: dir,
      entryPrice: last.close, entryTime: now,
      slPrice, quantity: qty,
      peakPrice: last.close, trailSL: false, partialBooked: false,
      status: 'OPEN', sessionKey: todayKey,
      capitalBefore: capNow,
      meta: {
        orbHigh: +orb.high.toFixed(2), orbLow: +orb.low.toFixed(2),
        vwap: +vwV.toFixed(2), ema9: +efN.toFixed(2), ema21: +esN.toFixed(2),
        rsi: +rsiV.toFixed(1), adx: +adxVal.toFixed(1),
        utcMin, dynSlPct: +dynSlPct.toFixed(4),
        tradeNo: sessionTrades.length + 1,
      },
    });
    this.logger.log(`*** ENTRY ${inst.symbol} ${dir} @ $${last.close} | qty ${qty} | SL $${slPrice} ***`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getCurrentCapital(excludeId?: string): Promise<number> {
    const closed = await this.tradeModel.find({ status: 'CLOSED' });
    const pnl = closed
      .filter(t => t._id.toString() !== excludeId)
      .reduce((s, t) => s + (t.netPnlUsdt ?? 0), 0);
    return +(STARTING_CAPITAL + pnl).toFixed(4);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getAccount() {
    const all    = await this.tradeModel.find().sort({ entryTime: 1 });
    const closed = all.filter(t => t.status === 'CLOSED' && t.netPnlUsdt != null);
    const open   = all.filter(t => t.status === 'OPEN');
    const wins   = closed.filter(t => (t.netPnlUsdt ?? 0) > 0);
    const netPnl = +closed.reduce((s, t) => s + (t.netPnlUsdt ?? 0), 0).toFixed(4);
    const equity = +(STARTING_CAPITAL + netPnl).toFixed(4);

    let eq = STARTING_CAPITAL;
    const curve: { date: string; equity: number }[] = [];
    for (const t of closed) {
      eq += t.netPnlUsdt ?? 0;
      curve.push({ date: new Date(t.exitTime!).toISOString().slice(0, 10), equity: +eq.toFixed(4) });
    }

    return {
      startingCapital: STARTING_CAPITAL,
      currency: 'USDT',
      equity,
      netPnl,
      roi: +(netPnl / STARTING_CAPITAL * 100).toFixed(2),
      totalTrades: all.length,
      openTrades: open.length,
      closedTrades: closed.length,
      wins: wins.length,
      winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
      avgWin:  wins.length
        ? +(wins.reduce((s, t) => s + (t.netPnlUsdt ?? 0), 0) / wins.length).toFixed(4)
        : 0,
      avgLoss: (closed.length - wins.length) > 0
        ? +(closed.filter(t => (t.netPnlUsdt ?? 0) <= 0)
            .reduce((s, t) => s + (t.netPnlUsdt ?? 0), 0) / (closed.length - wins.length)).toFixed(4)
        : 0,
      equityCurve: curve,
    };
  }

  async getRecent(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    return this.tradeModel.find({ entryTime: { $gte: from } }).sort({ entryTime: -1 });
  }

  async getToday() {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return this.tradeModel.find({ entryTime: { $gte: start } }).sort({ entryTime: -1 });
  }

  // Force-close all open positions (manual override)
  async closeAll(): Promise<number> {
    const open = await this.tradeModel.find({ status: 'OPEN' });
    for (const t of open) {
      await this.tradeModel.findByIdAndUpdate(t._id, {
        status: 'CLOSED', exitTime: new Date(), exitReason: 'MANUAL',
        netPnlUsdt: 0, capitalBefore: 0, capitalAfter: 0,
      });
    }
    return open.length;
  }

  // Manual trigger for testing (bypasses market hours check)
  async forceTick() {
    this.logger.log('Force tick triggered');
    await this.tick();
    return { triggered: true, time: new Date().toISOString() };
  }
}
