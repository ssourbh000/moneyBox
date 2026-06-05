import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketBar, MarketBarDocument } from '../market-data/schemas/market-bar.schema';
import { bsPrice, itmStrike, calcVWAP, calcSupertrend, calcORB, istHHMM, istDayOfWeek, isNewDay } from '../strategies/option-indicators';
import { ema, rsi, adx, atr, OHLCV } from '../strategies/indicators';
import { buildVixMap, computeMetrics } from '../backtest-shared/metrics.util';
import { SimParams } from './orb-simulator.controller';

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', lotSize: 65, tickSize: 50  },
  { symbol: 'NIFTY BANK', exchange: 'NSE', lotSize: 25, tickSize: 100 },
] as const;

const RISK_FREE_RATE     = 0.07;
const MAX_RISK_PER_TRADE = 4000;
const PARTIAL_MULT       = 1.8;
const ORB_BARS           = 9;
const ENTRY_FROM         = 1000;
const ENTRY_TO           = 1430;
const EXIT_TIME          = 1500;
const VIX_NORMAL_MAX     = 20;
const VIX_HIGH_MAX       = 28;
const RSI_BULL = 60, RSI_BEAR = 40, ADX_MIN = 20;
const RSI_BULL_HIGH = 55, RSI_BEAR_HIGH = 45, ADX_MIN_HIGH = 25;
const RSI_BULL_CRISIS = 65, RSI_BEAR_CRISIS = 35, ADX_MIN_CRISIS = 30;
const MAX_TRADES_CRISIS = 1, MAX_TRADES_PER_DAY = 4;
const COOLDOWN_MS = 20 * 60 * 1000;
const GAP_THRESHOLD = 0.005, VOL_SURGE = 1.5, VOL_AVG_BARS = 20;
const ST_PERIOD = 10, ST_MULT = 3, EMA_FAST = 9, EMA_SLOW = 21, RSI_PERIOD = 14;

interface OpenTrade {
  direction: 'CALL' | 'PUT'; strike: number; entryPremium: number;
  entryTime: Date; slPremium: number; lots: number;
  partialBooked: boolean; trailSL: boolean; peakPremium: number; vix: number;
  meta: Record<string, number | string>;
}

@Injectable()
export class OrbSimulatorService {
  constructor(
    @InjectModel(MarketBar.name) private barModel: Model<MarketBarDocument>,
  ) {}

  async run(p: SimParams) {
    const from = new Date(p.fromDate), to = new Date(p.toDate);
    const vixBars = await this.barModel
      .find({ symbol: 'INDIA VIX', exchange: 'NSE', interval: 'day', timestamp: { $gte: from, $lte: to } })
      .sort({ timestamp: 1 }).lean();
    const vixMap = buildVixMap(vixBars);

    const allTrades: any[] = [];
    for (const inst of INSTRUMENTS) {
      const trades = await this.simulateInstrument(inst, from, to, vixMap, p);
      allTrades.push(...trades);
    }
    allTrades.sort((a, b) => a.exitTime.localeCompare(b.exitTime));

    const metrics = computeMetrics(allTrades, p.capital);
    let equity = p.capital;
    const equityCurve = allTrades.map(t => {
      equity += t.netPnl;
      return { t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) };
    });

    return { params: p, metrics: { ...metrics, equityCurve }, trades: allTrades };
  }

  private async simulateInstrument(
    inst: typeof INSTRUMENTS[number],
    from: Date, to: Date,
    vixMap: Map<string, number>,
    p: SimParams,
  ) {
    const lookback = new Date(from); lookback.setMonth(lookback.getMonth() - 1);
    const [bars5, bars15] = await Promise.all([
      this.barModel.find({ symbol: inst.symbol, exchange: inst.exchange, interval: '5minute', timestamp: { $gte: lookback, $lte: to } }).sort({ timestamp: 1 }).lean(),
      this.barModel.find({ symbol: inst.symbol, exchange: inst.exchange, interval: '15minute', timestamp: { $gte: lookback, $lte: to } }).sort({ timestamp: 1 }).lean(),
    ]);
    if (bars5.length < 50) return [];

    const trades: any[] = [];
    let sessionBars: OHLCV[] = [], prevBar: typeof bars5[0] | null = null;
    const rollingBars: OHLCV[] = [], rolling15: OHLCV[] = [];
    let bar15Idx = 0, orbHigh = 0, orbLow = 0, orbSet = false;
    let openTrade: OpenTrade | null = null;
    let tradesOpenedToday = 0;
    let lastSLExitTime: Date | null = null;         // cooldown only after failed SL
    let blockedDirection: 'CALL' | 'PUT' | null = null; // direction blocked after SL hit
    let pdHigh = 0, pdLow = Infinity, dayHigh = 0, dayLow = Infinity;
    let prevDayClose = 0, todayOpen = 0, gapDir: 'UP' | 'DOWN' | 'NONE' = 'NONE';

    for (const bar of bars5) {
      const barDate = bar.timestamp, hhmm = istHHMM(barDate), dow = istDayOfWeek(barDate);
      const ohlcv: OHLCV = { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };

      while (bar15Idx < bars15.length && bars15[bar15Idx].timestamp <= barDate) {
        const b = bars15[bar15Idx];
        rolling15.push({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
        if (rolling15.length > 150) rolling15.shift();
        bar15Idx++;
      }

      if (!prevBar || isNewDay(prevBar.timestamp, barDate)) {
        if (openTrade && prevBar) {
          const T = this.tte(prevBar.timestamp);
          const ep = bsPrice(prevBar.close, openTrade.strike, RISK_FREE_RATE, T, 0.15, openTrade.direction === 'CALL' ? 'call' : 'put');
          trades.push(this.mk(inst, openTrade, ep, prevBar.timestamp, 'EOD'));
          openTrade = null; // EOD — no cooldown, no direction block
        }
        if (dayHigh > 0) { pdHigh = dayHigh; pdLow = dayLow; prevDayClose = prevBar?.close ?? 0; }
        todayOpen = bar.open;
        if (prevDayClose > 0) {
          const gp = (todayOpen - prevDayClose) / prevDayClose;
          gapDir = gp > GAP_THRESHOLD ? 'UP' : gp < -GAP_THRESHOLD ? 'DOWN' : 'NONE';
        }
        dayHigh = bar.high; dayLow = bar.low;
        sessionBars = []; orbSet = false; orbHigh = orbLow = 0;
        tradesOpenedToday = 0; lastSLExitTime = null; blockedDirection = null;
      } else {
        dayHigh = Math.max(dayHigh, bar.high);
        dayLow  = Math.min(dayLow,  bar.low);
      }
      prevBar = bar;
      rollingBars.push(ohlcv); if (rollingBars.length > 200) rollingBars.shift();

      if (barDate < from) { sessionBars.push(ohlcv); continue; }
      if (dow === 0 || dow === 5 || dow === 6) continue;

      const vix = vixMap.get(barDate.toISOString().slice(0, 10)) ?? 15;
      const regime = vix <= VIX_NORMAL_MAX ? 'NORMAL' : vix <= VIX_HIGH_MAX ? 'HIGH' : 'CRISIS';
      const rsiBull  = regime === 'CRISIS' ? RSI_BULL_CRISIS  : regime === 'HIGH' ? RSI_BULL_HIGH  : RSI_BULL;
      const rsiBear  = regime === 'CRISIS' ? RSI_BEAR_CRISIS  : regime === 'HIGH' ? RSI_BEAR_HIGH  : RSI_BEAR;
      const adxMin   = regime === 'CRISIS' ? ADX_MIN_CRISIS   : regime === 'HIGH' ? ADX_MIN_HIGH   : ADX_MIN;
      const maxTrades = regime === 'CRISIS' ? MAX_TRADES_CRISIS : MAX_TRADES_PER_DAY;
      sessionBars.push(ohlcv);

      if (!orbSet && sessionBars.length >= ORB_BARS && hhmm >= ENTRY_FROM) {
        const orb = calcORB(sessionBars, ORB_BARS);
        orbHigh = orb.high; orbLow = orb.low; orbSet = true;
      }

      if (openTrade) {
        const T = this.tte(barDate);
        const cp = bsPrice(bar.close, openTrade.strike, RISK_FREE_RATE, T, vix / 100, openTrade.direction === 'CALL' ? 'call' : 'put');
        if (cp > openTrade.peakPremium) openTrade.peakPremium = cp;
        const trailActive = cp >= openTrade.entryPremium * (1 + p.trailTrigger) || openTrade.trailSL;
        const contTrailSL = trailActive ? +(openTrade.peakPremium * (1 - p.trailPct)).toFixed(2) : openTrade.slPremium;
        if (trailActive && contTrailSL > openTrade.slPremium) { openTrade.slPremium = contTrailSL; openTrade.trailSL = true; }
        if (!openTrade.partialBooked && cp >= openTrade.entryPremium * PARTIAL_MULT) { openTrade.partialBooked = true; openTrade.lots = Math.max(1, Math.floor(openTrade.lots / 2)); }
        if (cp <= openTrade.slPremium) {
          const reason = openTrade.trailSL ? 'TRAIL_SL' : 'SL';
          trades.push(this.mk(inst, openTrade, openTrade.slPremium, barDate, reason));
          const isFailedSL = reason === 'SL';
          if (isFailedSL) {
            lastSLExitTime = barDate;                                              // always track for legacy cooldown
            if (p.directionBlock) blockedDirection = openTrade.direction;         // block direction if enabled
          }
          if (!p.smartCooldown) {
            // Old behaviour: cooldown after any exit
            lastSLExitTime = barDate;
          }
          openTrade = null;
        } else if (hhmm >= EXIT_TIME) {
          trades.push(this.mk(inst, openTrade, cp, barDate, 'EOD'));
          if (!p.smartCooldown) lastSLExitTime = barDate; // old: cooldown after EOD too
          openTrade = null;
        }
        continue;
      }

      if (!orbSet || hhmm < ENTRY_FROM || hhmm > ENTRY_TO) continue;
      if (tradesOpenedToday >= maxTrades) continue;
      // Cooldown only after a failed SL (not after TRAIL_SL or EOD)
      if (lastSLExitTime && barDate.getTime() - lastSLExitTime.getTime() < COOLDOWN_MS) continue;
      if (rollingBars.length < Math.max(EMA_SLOW, RSI_PERIOD, ST_PERIOD * 2) + 5) continue;
      if (regime === 'CRISIS' && gapDir === 'NONE') continue;

      const rc = rollingBars.map(b => b.close);
      const efArr = ema(rc, EMA_FAST), esArr = ema(rc, EMA_SLOW), rvArr = rsi(rc, RSI_PERIOD);
      const st = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT), vw = calcVWAP(sessionBars);
      const efN = efArr[efArr.length - 1], esN = esArr[esArr.length - 1];
      const rsiV = rvArr[rvArr.length - 1], vwV = vw[vw.length - 1], tN = st.trend[st.trend.length - 1];
      if (!efN || !esN || !rsiV || !vwV || tN === 0) continue;

      const adxVal = adx(rollingBars, 14);
      if (adxVal < adxMin) continue;

      const callOk = bar.close > orbHigh && tN === 1 && efN > esN && bar.close > vwV && rsiV > rsiBull;
      const putOk  = bar.close < orbLow  && tN === -1 && efN < esN && bar.close < vwV && rsiV < rsiBear;
      if (!callOk && !putOk) continue;
      if (gapDir === 'UP' && putOk && !callOk) continue;
      if (gapDir === 'DOWN' && callOk && !putOk) continue;
      if (pdHigh > 0 && pdLow < Infinity) {
        if (callOk && bar.close <= pdHigh) continue;
        if (putOk  && bar.close >= pdLow)  continue;
      }

      const recentVols = rollingBars.slice(-VOL_AVG_BARS).map(b => b.volume);
      const volAvg = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
      if (volAvg > 0 && bar.volume < volAvg * VOL_SURGE) continue;

      if (rolling15.length >= EMA_SLOW + 5) {
        const c15 = rolling15.map(b => b.close);
        const ef15 = ema(c15, EMA_FAST), es15 = ema(c15, EMA_SLOW);
        const ef15N = ef15[ef15.length - 1], es15N = es15[es15.length - 1];
        if (ef15N && es15N) {
          if (callOk && ef15N <= es15N) continue;
          if (putOk  && ef15N >= es15N) continue;
        }
      }

      // Direction block (if enabled): SL on CALL blocks CALL for day, PUT still allowed
      const effectiveCallOk = callOk && (!p.directionBlock || blockedDirection !== 'CALL');
      const effectivePutOk  = putOk  && (!p.directionBlock || blockedDirection !== 'PUT');
      if (!effectiveCallOk && !effectivePutOk) continue;
      const dir: 'CALL' | 'PUT' = effectiveCallOk ? 'CALL' : 'PUT';
      const strike = itmStrike(bar.close, dir, inst.tickSize);
      const T = this.tte(barDate);
      const ep = bsPrice(bar.close, strike, RISK_FREE_RATE, T, vix / 100, dir === 'CALL' ? 'call' : 'put');
      if (ep < 10) continue;
      const slP = +(ep * (1 - p.slPct)).toFixed(2);
      const lots = Math.max(1, Math.floor(MAX_RISK_PER_TRADE / ((ep - slP) * inst.lotSize)));
      tradesOpenedToday++;
      openTrade = { direction: dir, strike, entryPremium: +ep.toFixed(2), entryTime: barDate, slPremium: slP, lots, partialBooked: false, trailSL: false, peakPremium: +ep.toFixed(2), vix, meta: { orbHigh: +orbHigh.toFixed(2), orbLow: +orbLow.toFixed(2), vwap: +vwV.toFixed(2), ema9: +efN.toFixed(2), ema21: +esN.toFixed(2), rsi: +rsiV.toFixed(1), adx: +adxVal.toFixed(1), regime } };
    }
    return trades;
  }

  private mk(inst: typeof INSTRUMENTS[number], t: OpenTrade, exitPrem: number, exitTime: Date, reason: string) {
    const gp = (exitPrem - t.entryPremium) * t.lots * inst.lotSize;
    return { symbol: inst.symbol, direction: t.direction, entryTime: t.entryTime.toISOString(), exitTime: exitTime.toISOString(), strike: t.strike, entryPremium: t.entryPremium, exitPremium: +exitPrem.toFixed(2), lots: t.lots, lotSize: inst.lotSize, grossPnl: +gp.toFixed(2), netPnl: +(gp - 40 * t.lots).toFixed(2), exitReason: reason, vix: t.vix, meta: t.meta };
  }

  private tte(date: Date): number {
    const ist = new Date(date.getTime() + 5.5 * 3600000), dow = ist.getUTCDay();
    const dtt = ((4 - dow + 7) % 7) || 7, hl = 15.5 - (ist.getUTCHours() + ist.getUTCMinutes() / 60);
    return Math.max((dtt - 1 + hl / 6.25) / 365, 1 / 365);
  }
}
