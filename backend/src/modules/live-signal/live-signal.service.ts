import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { PaperTrade, PaperTradeDocument } from './schemas/paper-trade.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { ema, rsi, adx, atr, OHLCV } from '../strategies/indicators';
import {
  bsPrice, itmStrike, calcVWAP, calcSupertrend, calcORB,
  istHHMM, istDayOfWeek, isNewDay,
} from '../strategies/option-indicators';

// ── Strategy B v4: VIX Regime Mode — live paper trading engine ───────────────

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 65, tickSize: 50  },
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 25, tickSize: 100 },
] as const;

const STARTING_CAPITAL   = 20_000;
const RISK_FREE_RATE     = 0.07;
const MAX_RISK           = 2_000;   // 10% of ₹20k per trade
const SL_PCT             = 0.12;   // fixed SL: exit if premium drops 12% from entry
const TRAIL_TRIGGER      = 0.15;   // trail activates after premium rises 15% from entry
const TRAIL_PCT          = 0.12;   // trail SL sits 12% below running peak
const PARTIAL_MULT       = 1.8;
const ORB_BARS           = 9;       // 9 × 5min = 45-min ORB
const ENTRY_FROM         = 1000;
const ENTRY_TO           = 1430;
const EXIT_TIME          = 1500;
const VIX_NORMAL_MAX     = 20;
const VIX_HIGH_MAX       = 28;
// NORMAL / CALM regime
const RSI_BULL           = 60;
const RSI_BEAR           = 40;
const ADX_MIN            = 20;
// HIGH regime (VIX 20–28)
const RSI_BULL_HIGH      = 55;
const RSI_BEAR_HIGH      = 45;
const ADX_MIN_HIGH       = 25;
// CRISIS regime (VIX > 28)
const RSI_BULL_CRISIS    = 65;
const RSI_BEAR_CRISIS    = 35;
const ADX_MIN_CRISIS     = 30;
const MAX_TRADES_CRISIS  = 1;
const MAX_TRADES_PER_DAY = 2;   // direction block makes >2 redundant
const DAILY_LOSS_LIMIT   = 2_000; // hard stop across ALL instruments (₹2,000 = 10% of ₹20k)
const COOLDOWN_MS        = 20 * 60 * 1000;
const GAP_THRESHOLD      = 0.005;
const VOL_SURGE          = 1.5;
const VOL_AVG_BARS       = 20;
const ST_PERIOD          = 10;
const ST_MULT            = 3;
const EMA_FAST           = 9;
const EMA_SLOW           = 21;
const RSI_PERIOD         = 14;
const BROKERAGE          = 40;   // per lot

@Injectable()
export class LiveSignalService {
  private readonly logger = new Logger(LiveSignalService.name);
  private lastTick: { time: string; vix: number; regime: string; results: string[] } | null = null;

  constructor(
    @InjectModel(PaperTrade.name) private paperModel: Model<PaperTradeDocument>,
    private marketData: MarketDataService,
  ) {}

  // ── Fires every 5 min, Mon–Fri, 3:00–9:59 UTC (= 8:30–15:30 IST) ──────────
  @Cron('*/5 4-9 * * 1-5', { timeZone: 'UTC' })
  async tick() {
    const hhmm = istHHMM(new Date());
    if (hhmm < 915 || hhmm > EXIT_TIME) return;
    this.logger.log(`Tick at IST ${hhmm}`);

    // Pull today's VIX (latest daily bar)
    const vixFrom = new Date(Date.now() - 3 * 86_400_000);
    const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', vixFrom, new Date());
    const vix = vixBars.length ? vixBars[vixBars.length - 1].close : 15;
    const regime = vix <= VIX_NORMAL_MAX ? 'NORMAL' : vix <= VIX_HIGH_MAX ? 'HIGH' : 'CRISIS';

    const results: string[] = [];
    for (const inst of INSTRUMENTS) {
      try {
        const msg = await this.processInstrument(inst, vix);
        results.push(msg);
      } catch (err) {
        this.logger.error(`${inst.symbol} tick error: ${err}`);
        results.push(`${inst.symbol}: error — ${err}`);
      }
    }
    this.lastTick = { time: new Date().toISOString(), vix: +vix.toFixed(1), regime, results };
  }

  async forceTick() {
    await this.tick();
    return this.lastTick;
  }

  getLastTick() { return this.lastTick; }

  // ── Core per-instrument logic ─────────────────────────────────────────────

  private async processInstrument(inst: typeof INSTRUMENTS[number], vix: number): Promise<string> {
    const sym = inst.symbol.replace('NIFTY ', 'NIFTY');
    const now = new Date();
    const hhmm = istHHMM(now);
    const todayKey = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

    // ── Load bars ────────────────────────────────────────────────────────────
    const lookbackFrom = new Date(Date.now() - 30 * 86_400_000);
    const [allBars5, allBars15] = await Promise.all([
      this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookbackFrom, now),
      this.marketData.getCandles(inst.symbol, inst.exchange, '15minute', lookbackFrom, now),
    ]);
    if (allBars5.length < 50) {
      this.logger.log(`${inst.symbol}: not enough bars (${allBars5.length})`);
      return `${sym}: not enough bars (${allBars5.length} < 50)`;
    }

    const last5 = allBars5[allBars5.length - 1];

    // Rolling 200 5-min bars (across days, for EMA/RSI/Supertrend/ADX/ATR)
    const rollingBars: OHLCV[] = allBars5.slice(-200).map(b => ({
      open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));

    // Today's session bars
    const sessionBars: OHLCV[] = allBars5
      .filter(b => b.timestamp.toISOString().slice(0, 10) === todayKey)
      .map(b => ({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));

    if (sessionBars.length < 3) {
      this.logger.log(`${inst.symbol}: too few session bars (${sessionBars.length})`);
      return `${sym}: too few session bars (${sessionBars.length})`;
    }

    // 15-min rolling bars (for MTF EMA)
    const rolling15: OHLCV[] = allBars15.slice(-150).map(b => ({
      open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));

    // ── PDH/PDL + gap direction ───────────────────────────────────────────────
    const todayStartIST = new Date(todayKey + 'T00:00:00+05:30');
    const prevBars = allBars5.filter(b => b.timestamp < todayStartIST);
    // Find yesterday's bars
    const prevDayKey = prevBars.length
      ? prevBars[prevBars.length - 1].timestamp.toISOString().slice(0, 10)
      : null;
    const ydBars = prevDayKey
      ? allBars5.filter(b => b.timestamp.toISOString().slice(0, 10) === prevDayKey)
      : [];
    const pdHigh  = ydBars.length ? Math.max(...ydBars.map(b => b.high))  : 0;
    const pdLow   = ydBars.length ? Math.min(...ydBars.map(b => b.low))   : Infinity;
    const prevClose = ydBars.length ? ydBars[ydBars.length - 1].close : 0;
    const todayOpen = sessionBars[0].open;
    const gapPct  = prevClose > 0 ? (todayOpen - prevClose) / prevClose : 0;
    const gapDir: 'UP' | 'DOWN' | 'NONE' = gapPct > GAP_THRESHOLD ? 'UP' : gapPct < -GAP_THRESHOLD ? 'DOWN' : 'NONE';

    // ── ORB: computed from first 9 session bars ───────────────────────────────
    let orbHigh = 0, orbLow = 0, orbSet = false;
    if (sessionBars.length >= ORB_BARS) {
      const orb = calcORB(sessionBars, ORB_BARS);
      orbHigh = orb.high; orbLow = orb.low; orbSet = true;
    }

    // ── VIX regime ────────────────────────────────────────────────────────────
    const regime = vix <= VIX_NORMAL_MAX ? 'NORMAL' : vix <= VIX_HIGH_MAX ? 'HIGH' : 'CRISIS';
    const rsiBull  = regime === 'CRISIS' ? RSI_BULL_CRISIS : regime === 'HIGH' ? RSI_BULL_HIGH  : RSI_BULL;
    const rsiBear  = regime === 'CRISIS' ? RSI_BEAR_CRISIS : regime === 'HIGH' ? RSI_BEAR_HIGH  : RSI_BEAR;
    const adxMin   = regime === 'CRISIS' ? ADX_MIN_CRISIS  : regime === 'HIGH' ? ADX_MIN_HIGH   : ADX_MIN;
    const trailPct = TRAIL_PCT;
    const maxTrades = regime === 'CRISIS' ? MAX_TRADES_CRISIS : MAX_TRADES_PER_DAY;

    // ── Manage open position ──────────────────────────────────────────────────
    const open = await this.paperModel.findOne({ symbol: inst.symbol, status: 'OPEN' });
    if (open) {
      const T = this.tte(now);
      const cp = bsPrice(last5.close, open.strike, RISK_FREE_RATE, T, vix / 100,
        open.direction === 'CALL' ? 'call' : 'put');

      // Update trailing SL — trail only activates after +20% rise from entry
      const newPeak    = Math.max(open.peakPremium ?? open.entryPremium, cp);
      const fixedSL    = +(open.entryPremium * (1 - SL_PCT)).toFixed(2);
      const trailActive = cp >= open.entryPremium * (1 + TRAIL_TRIGGER) || open.trailSL;
      const contTrailSL = trailActive ? +(newPeak * (1 - trailPct)).toFixed(2) : fixedSL;
      const newSL      = Math.max(open.slPremium, contTrailSL);
      const nowTrail   = trailActive;

      // Partial booking at 1.8× — reduce lots
      let newLots = open.lots;
      if (!open.partialBooked && cp >= open.entryPremium * PARTIAL_MULT) {
        newLots = Math.max(1, Math.floor(open.lots / 2));
        this.logger.log(`${inst.symbol}: partial booking at ₹${cp.toFixed(2)} — lots ${open.lots} → ${newLots}`);
      }
      const partialNow = open.partialBooked || cp >= open.entryPremium * PARTIAL_MULT;

      // Persist updated state
      await this.paperModel.findByIdAndUpdate(open._id, {
        peakPremium: newPeak,
        slPremium: newSL,
        trailSL: nowTrail,
        lots: newLots,
        partialBooked: partialNow,
      });

      const exitNow = cp <= newSL || hhmm >= EXIT_TIME;
      if (exitNow) {
        const exitReason = hhmm >= EXIT_TIME ? 'EOD' : (nowTrail ? 'TRAIL_SL' : 'SL');
        const gp = (cp - open.entryPremium) * newLots * inst.lotSize;
        const netPnl = +(gp - BROKERAGE * newLots).toFixed(2);
        const capBefore = await this.getCurrentCapital(open._id.toString());
        await this.paperModel.findByIdAndUpdate(open._id, {
          status: 'CLOSED',
          exitPremium: +cp.toFixed(2),
          exitTime: now,
          exitReason,
          netPnl,
          capitalBefore: capBefore,
          capitalAfter: +(capBefore + netPnl).toFixed(2),
        });
        this.logger.log(`Paper CLOSED: ${inst.symbol} ${open.direction} @ ₹${cp.toFixed(2)} | P&L ₹${netPnl} | Reason: ${exitReason}`);
        return `${sym}: CLOSED ${open.direction} @ ₹${cp.toFixed(2)} | ${exitReason} | P&L ₹${netPnl}`;
      } else {
        this.logger.log(`${inst.symbol} open trade: curr ₹${cp.toFixed(2)} peak ₹${newPeak.toFixed(2)} SL ₹${newSL.toFixed(2)}`);
        return `${sym}: OPEN ${open.direction} @ ₹${cp.toFixed(2)} | peak ₹${newPeak.toFixed(2)} | SL ₹${newSL.toFixed(2)}`;
      }
    }

    // ── Entry check ───────────────────────────────────────────────────────────
    if (!orbSet) return `${sym}: ORB building (${sessionBars.length}/${ORB_BARS} bars)`;
    if (hhmm < ENTRY_FROM || hhmm > ENTRY_TO) return `${sym}: outside entry window (${hhmm})`;


    // Count today's trades for max-trades-per-day
    const todayTrades = await this.paperModel.find({
      symbol: inst.symbol,
      entryTime: { $gte: todayStartIST },
    });
    const tradesOpenedToday = todayTrades.length;
    if (tradesOpenedToday >= maxTrades) return `${sym}: max trades reached (${tradesOpenedToday}/${maxTrades})`;

    // Cooldown from last exit
    const closedToday = todayTrades.filter(t => t.status === 'CLOSED' && t.exitTime);
    if (closedToday.length > 0) {
      const lastExit = closedToday.sort((a, b) =>
        new Date(b.exitTime!).getTime() - new Date(a.exitTime!).getTime())[0].exitTime!;
      if (now.getTime() - new Date(lastExit).getTime() < COOLDOWN_MS) return `${sym}: in 20-min cooldown`;
    }

    // Daily loss limit — cross-instrument hard stop (query ALL symbols, not just this one)
    const allTodayTrades = await this.paperModel.find({ entryTime: { $gte: todayStartIST }, status: 'CLOSED' });
    const totalDayLoss = allTodayTrades
      .filter(t => (t.netPnl ?? 0) < 0)
      .reduce((sum, t) => sum + Math.abs(t.netPnl ?? 0), 0);
    if (totalDayLoss >= DAILY_LOSS_LIMIT) {
      return `${sym}: daily loss limit hit (₹${totalDayLoss.toFixed(0)} ≥ ₹${DAILY_LOSS_LIMIT}) — no more trades today`;
    }

    // Direction block: if a fixed SL hit today, block that direction for rest of day
    const slHitsToday = closedToday.filter(t => t.exitReason === 'SL');
    const blockedDir = slHitsToday.length > 0 ? slHitsToday[slHitsToday.length - 1].direction : null;
    if (blockedDir) this.logger.log(`${inst.symbol}: direction block active — ${blockedDir} blocked after SL hit`);

    // CRISIS regime: only trade with gap direction
    if (regime === 'CRISIS' && gapDir === 'NONE') return `${sym}: CRISIS regime requires gap direction`;

    if (rollingBars.length < Math.max(EMA_SLOW, RSI_PERIOD, ST_PERIOD * 2) + 5) return `${sym}: not enough rolling bars`;

    // ── Indicators ────────────────────────────────────────────────────────────
    const rc = rollingBars.map(b => b.close);
    const efArr = ema(rc, EMA_FAST), esArr = ema(rc, EMA_SLOW), rvArr = rsi(rc, RSI_PERIOD);
    const st = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT);
    const vw = calcVWAP(sessionBars);
    const efN = efArr[efArr.length - 1], esN = esArr[esArr.length - 1];
    const rsiV = rvArr[rvArr.length - 1], vwV = vw[vw.length - 1];
    const tN = st.trend[st.trend.length - 1];
    if (!efN || !esN || !rsiV || !vwV || tN === 0) return `${sym}: insufficient indicator data`;

    // ADX filter
    const adxVal = adx(rollingBars, 14);
    if (adxVal < adxMin) {
      this.logger.log(`${inst.symbol}: ADX ${adxVal.toFixed(1)} < ${adxMin} — skip`);
      return `${sym}: ADX ${adxVal.toFixed(1)} < ${adxMin} (market not trending)`;
    }

    const bar = last5;
    const callOk = bar.close > orbHigh && tN === 1 && efN > esN && bar.close > vwV && rsiV > rsiBull;
    const putOk  = bar.close < orbLow  && tN === -1 && efN < esN && bar.close < vwV && rsiV < rsiBear;
    if (!callOk && !putOk) {
      this.logger.log(`${inst.symbol} @ ${hhmm}: no signal. close=${bar.close.toFixed(0)} orbH=${orbHigh.toFixed(0)} orbL=${orbLow.toFixed(0)} ema=${efN.toFixed(0)}/${esN.toFixed(0)} rsi=${rsiV.toFixed(1)} st=${tN}`);
      return `${sym}: no signal — close ${bar.close.toFixed(0)} vs ORB [${orbLow.toFixed(0)}–${orbHigh.toFixed(0)}] | EMA ${efN.toFixed(0)}/${esN.toFixed(0)} | RSI ${rsiV.toFixed(1)} | ST ${tN > 0 ? '▲' : '▼'}`;
    }

    // Gap direction lock
    if (gapDir === 'UP'   && putOk  && !callOk) return `${sym}: gap UP — PUT signal blocked`;
    if (gapDir === 'DOWN' && callOk && !putOk)  return `${sym}: gap DOWN — CALL signal blocked`;

    // PDH/PDL break required
    if (pdHigh > 0 && pdLow < Infinity) {
      if (callOk && bar.close <= pdHigh) return `${sym}: CALL needs PDH break (${bar.close.toFixed(0)} ≤ ${pdHigh.toFixed(0)})`;
      if (putOk  && bar.close >= pdLow)  return `${sym}: PUT needs PDL break (${bar.close.toFixed(0)} ≥ ${pdLow.toFixed(0)})`;
    }

    // Volume surge
    const recentVols = rollingBars.slice(-VOL_AVG_BARS).map(b => b.volume);
    const volAvg = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
    if (volAvg > 0 && bar.volume < volAvg * VOL_SURGE) {
      this.logger.log(`${inst.symbol}: volume surge failed (${bar.volume} < ${(volAvg * VOL_SURGE).toFixed(0)})`);
      return `${sym}: volume too low (${bar.volume} < ${(volAvg * VOL_SURGE).toFixed(0)} required)`;
    }

    // 15-min MTF EMA alignment
    if (rolling15.length >= EMA_SLOW + 5) {
      const c15 = rolling15.map(b => b.close);
      const ef15 = ema(c15, EMA_FAST), es15 = ema(c15, EMA_SLOW);
      const ef15N = ef15[ef15.length - 1], es15N = es15[es15.length - 1];
      if (ef15N && es15N) {
        if (callOk && ef15N <= es15N) return `${sym}: CALL blocked — 15min EMA bearish (${ef15N.toFixed(0)} ≤ ${es15N.toFixed(0)})`;
        if (putOk  && ef15N >= es15N) return `${sym}: PUT blocked — 15min EMA bullish (${ef15N.toFixed(0)} ≥ ${es15N.toFixed(0)})`;
      }
    }

    // ── Direction block: apply before entry ──────────────────────────────────
    const effectiveCallOk = callOk && blockedDir !== 'CALL';
    const effectivePutOk  = putOk  && blockedDir !== 'PUT';
    if (!effectiveCallOk && !effectivePutOk) {
      return `${sym}: direction blocked — ${blockedDir} SL hit earlier today, no ${blockedDir} re-entry`;
    }

    // ── Fire entry ────────────────────────────────────────────────────────────
    const dir: 'CALL' | 'PUT' = effectiveCallOk ? 'CALL' : 'PUT';
    const strike = itmStrike(bar.close, dir, inst.tickSize);
    const T = this.tte(now);
    const ep = bsPrice(bar.close, strike, RISK_FREE_RATE, T, vix / 100,
      dir === 'CALL' ? 'call' : 'put');
    if (ep < 10) return `${sym}: premium too low (₹${ep.toFixed(2)} < ₹10)`;

    // Fixed SL for lot sizing
    const slP = +(ep * (1 - SL_PCT)).toFixed(2);
    const lots = Math.max(1, Math.floor(MAX_RISK / ((ep - slP) * inst.lotSize)));

    const capitalNow = await this.getCurrentCapital();

    await this.paperModel.create({
      symbol: inst.symbol,
      direction: dir,
      strike,
      entryPremium: +ep.toFixed(2),
      entryTime: now,
      exitReason: undefined,
      slPremium: slP,
      lots,
      lotSize: inst.lotSize,
      status: 'OPEN',
      vix,
      peakPremium: +ep.toFixed(2),
      trailSL: false,
      partialBooked: false,
      regime,
      capitalBefore: capitalNow,
      meta: {
        orbHigh: +orbHigh.toFixed(2),
        orbLow:  +orbLow.toFixed(2),
        vwap:    +vwV.toFixed(2),
        ema9:    +efN.toFixed(2),
        ema21:   +esN.toFixed(2),
        rsi:     +rsiV.toFixed(1),
        adx:     +adxVal.toFixed(1),
        gapDir,
        regime,
        vixVal:  +vix.toFixed(1),
      },
    });
    this.logger.log(`*** Paper ENTRY: ${inst.symbol} ${dir} ${strike} @ ₹${ep.toFixed(2)} | ${lots} lot(s) | SL ₹${slP} | regime: ${regime} ***`);
    return `${sym}: *** ENTRY ${dir} ${strike} @ ₹${ep.toFixed(2)} | ${lots} lot(s) | SL ₹${slP} | ${regime} ***`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private tte(now: Date): number {
    const ist = new Date(now.getTime() + 5.5 * 3_600_000);
    const dow = ist.getUTCDay();
    const dtt = ((4 - dow + 7) % 7) || 7;
    const hl = 15.5 - (ist.getUTCHours() + ist.getUTCMinutes() / 60);
    return Math.max((dtt - 1 + hl / 6.25) / 365, 1 / 365);
  }

  // Capital = starting capital + sum of all closed paper trades
  private async getCurrentCapital(excludeId?: string): Promise<number> {
    const closed = await this.paperModel.find({ status: 'CLOSED' });
    const pnl = closed
      .filter(t => t._id.toString() !== excludeId)
      .reduce((s, t) => s + (t.netPnl ?? 0), 0);
    return +(STARTING_CAPITAL + pnl).toFixed(2);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getToday(): Promise<PaperTradeDocument[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.paperModel.find({ entryTime: { $gte: start } }).sort({ entryTime: -1 });
  }

  async getRecent(days = 30): Promise<PaperTradeDocument[]> {
    const from = new Date(Date.now() - days * 86_400_000);
    return this.paperModel.find({ entryTime: { $gte: from } }).sort({ entryTime: -1 });
  }

  async getAccount() {
    const all = await this.paperModel.find().sort({ entryTime: 1 });
    const closed = all.filter(t => t.status === 'CLOSED' && t.netPnl != null);
    const open   = all.filter(t => t.status === 'OPEN');
    const wins   = closed.filter(t => (t.netPnl ?? 0) > 0);
    const netPnl = +closed.reduce((s, t) => s + (t.netPnl ?? 0), 0).toFixed(2);
    const equity = +(STARTING_CAPITAL + netPnl).toFixed(2);

    // Build equity curve
    let eq = STARTING_CAPITAL;
    const curve: { date: string; equity: number }[] = [];
    for (const t of closed) {
      eq += t.netPnl ?? 0;
      curve.push({ date: new Date(t.exitTime!).toISOString().slice(0, 10), equity: +eq.toFixed(2) });
    }

    return {
      startingCapital: STARTING_CAPITAL,
      equity,
      netPnl,
      roi: +(netPnl / STARTING_CAPITAL * 100).toFixed(2),
      totalTrades: all.length,
      openTrades: open.length,
      closedTrades: closed.length,
      wins: wins.length,
      winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
      avgWin:  wins.length ? +(wins.reduce((s, t) => s + (t.netPnl ?? 0), 0) / wins.length).toFixed(2) : 0,
      avgLoss: (closed.length - wins.length) > 0
        ? +(closed.filter(t => (t.netPnl ?? 0) <= 0).reduce((s, t) => s + (t.netPnl ?? 0), 0) / (closed.length - wins.length)).toFixed(2)
        : 0,
      equityCurve: curve,
    };
  }

  async getSummary(days = 30) {
    const trades = await this.getRecent(days);
    const closed = trades.filter(t => t.status === 'CLOSED' && t.netPnl != null);
    const wins = closed.filter(t => (t.netPnl ?? 0) > 0);
    return {
      total: trades.length,
      open: trades.filter(t => t.status === 'OPEN').length,
      closed: closed.length,
      wins: wins.length,
      winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
      netPnl: +closed.reduce((s, t) => s + (t.netPnl ?? 0), 0).toFixed(2),
    };
  }
}
