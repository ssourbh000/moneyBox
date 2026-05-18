import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { PaperTrade, PaperTradeDocument } from './schemas/paper-trade.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { ema, rsi, OHLCV } from '../strategies/indicators';
import {
  bsPrice, itmStrike, calcVWAP, calcSupertrend, calcORB,
  istHHMM, isNewDay,
} from '../strategies/option-indicators';

const INSTRUMENTS = [
  { symbol: 'NIFTY 50',   exchange: 'NSE', token: '99926000', lotSize: 25, tickSize: 50  },
  { symbol: 'NIFTY BANK', exchange: 'NSE', token: '99926009', lotSize: 15, tickSize: 100 },
] as const;

const VIX_TOKEN     = '99926017';
const RISK_FREE_RATE = 0.07;
const MAX_RISK      = 4000;
const SL_PCT        = 0.45;
const ENTRY_FROM    = 930;
const ENTRY_TO      = 1030;
const EXIT_TIME     = 1500;
const VIX_MAX       = 18;
const RSI_BULL      = 55;
const RSI_BEAR      = 45;
const ST_PERIOD     = 10;
const ST_MULT       = 3;
const ROLLING_MAX   = 200;

@Injectable()
export class LiveSignalService {
  private readonly logger = new Logger(LiveSignalService.name);

  constructor(
    @InjectModel(PaperTrade.name) private paperModel: Model<PaperTradeDocument>,
    private marketData: MarketDataService,
  ) {}

  // ── Fires every 5 min, Mon–Fri, 3:45–9:30 UTC (= 9:15–15:00 IST) ──────────
  @Cron('*/5 3-9 * * 1-5')
  async tick() {
    const hhmm = istHHMM(new Date());
    if (hhmm < 915 || hhmm > EXIT_TIME) return;

    this.logger.log(`Tick at IST ${hhmm}`);

    // Pull VIX from DB (daily bar seeded by Angel One)
    const todayKey = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 2 * 86_400_000);
    const vixBars = await this.marketData.getCandles('INDIA VIX', 'NSE', 'day', yesterday, new Date());
    const vix = vixBars.length ? vixBars[vixBars.length - 1].close : 15;
    if (vix > VIX_MAX) { this.logger.log(`VIX ${vix} > ${VIX_MAX} — skip`); return; }

    for (const inst of INSTRUMENTS) {
      await this.processInstrument(inst, todayKey, vix);
    }
  }

  // ── Evaluate signal for one instrument ───────────────────────────────────

  private async processInstrument(
    inst: typeof INSTRUMENTS[number],
    todayKey: string,
    vix: number,
  ) {
    const hhmm = istHHMM(new Date());

    // Load rolling 200 bars from DB (cross-day, for EMA/RSI/Supertrend)
    const lookbackFrom = new Date(Date.now() - 30 * 86_400_000);
    const allBars = await this.marketData.getCandles(inst.symbol, inst.exchange, '5minute', lookbackFrom, new Date());
    if (allBars.length < 50) { this.logger.log(`${inst.symbol}: not enough bars (${allBars.length})`); return; }

    const rollingBars: OHLCV[] = allBars.slice(-ROLLING_MAX).map((b) => ({
      open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    }));

    // Session bars = today only (for VWAP + ORB)
    const sessionBars: OHLCV[] = allBars
      .filter((b) => b.timestamp.toISOString().slice(0, 10) === todayKey)
      .map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));

    if (sessionBars.length < 3) { this.logger.log(`${inst.symbol}: too few session bars (${sessionBars.length})`); return; }

    const last = rollingBars[rollingBars.length - 1];

    // ── Manage open paper positions ─────────────────────────────────────────
    const open = await this.paperModel.findOne({ symbol: inst.symbol, status: 'OPEN' });
    if (open) {
      const T = this.timeToExpiry();
      const currPrem = bsPrice(last.close, open.strike, RISK_FREE_RATE, T, vix / 100, open.direction === 'CALL' ? 'call' : 'put');
      if (currPrem <= open.slPremium || hhmm >= EXIT_TIME) {
        const netPnl = (currPrem - open.entryPremium) * open.lots * open.lotSize - 40 * open.lots;
        await this.paperModel.findByIdAndUpdate(open._id, {
          status: 'CLOSED',
          exitPremium: +currPrem.toFixed(2),
          exitTime: new Date(),
          exitReason: hhmm >= EXIT_TIME ? 'EOD' : 'SL',
          netPnl: +netPnl.toFixed(2),
        });
        this.logger.log(`Paper CLOSED: ${inst.symbol} ${open.direction} @ ₹${currPrem.toFixed(2)} | P&L ₹${netPnl.toFixed(2)}`);
      }
      return;
    }

    // ── Entry check ─────────────────────────────────────────────────────────
    if (hhmm < ENTRY_FROM || hhmm > ENTRY_TO) return;

    const rCloses = rollingBars.map((b) => b.close);
    const emaFast = ema(rCloses, 9);
    const emaSlow = ema(rCloses, 21);
    const rsiVals = rsi(rCloses, 14);
    const st = calcSupertrend(rollingBars, ST_PERIOD, ST_MULT);
    const vwap = calcVWAP(sessionBars);
    const orb  = calcORB(sessionBars, 3);

    const ef       = emaFast[emaFast.length - 1];
    const es       = emaSlow[emaSlow.length - 1];
    const rsiVal   = rsiVals[rsiVals.length - 1];
    const vwapVal  = vwap[vwap.length - 1];
    const trendNow  = st.trend[st.trend.length - 1];
    const trendPrev = st.trend[st.trend.length - 2];

    if (!ef || !es || !rsiVal || !vwapVal) return;

    const bullFlip = trendPrev !== 1 && trendNow === 1;
    const bearFlip = trendPrev !== -1 && trendNow === -1;

    const callSignal = bullFlip && last.close > orb.high && last.close > vwapVal && ef > es && rsiVal > RSI_BULL;
    const putSignal  = bearFlip && last.close < orb.low  && last.close < vwapVal && ef < es && rsiVal < RSI_BEAR;

    this.logger.log(`${inst.symbol} @ ${hhmm}: flip=${bullFlip||bearFlip} orb=${last.close > orb.high || last.close < orb.low} ema=${ef > es} rsi=${rsiVal.toFixed(1)}`);

    if (!callSignal && !putSignal) return;

    const direction: 'CALL' | 'PUT' = callSignal ? 'CALL' : 'PUT';
    const strike = itmStrike(last.close, direction, inst.tickSize);
    const T = this.timeToExpiry();
    const entryPrem = bsPrice(last.close, strike, RISK_FREE_RATE, T, vix / 100, direction === 'CALL' ? 'call' : 'put');
    if (entryPrem < 10) return;

    const slPrem = +(entryPrem * SL_PCT).toFixed(2);
    const lots = Math.max(1, Math.floor(MAX_RISK / ((entryPrem - slPrem) * inst.lotSize)));

    await this.paperModel.create({
      symbol: inst.symbol, direction, strike,
      entryPremium: +entryPrem.toFixed(2),
      entryTime: new Date(),
      slPremium: slPrem,
      lots, lotSize: inst.lotSize,
      status: 'OPEN', vix,
      meta: { orbHigh: +orb.high.toFixed(2), orbLow: +orb.low.toFixed(2), vwap: +vwapVal.toFixed(2), ema9: +ef.toFixed(2), ema21: +es.toFixed(2), rsi: +rsiVal.toFixed(1) },
    });
    this.logger.log(`*** Paper ENTRY: ${inst.symbol} ${direction} ${strike} @ ₹${entryPrem.toFixed(2)} | ${lots} lot(s) | SL ₹${slPrem} ***`);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getToday(): Promise<PaperTradeDocument[]> {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return this.paperModel.find({ entryTime: { $gte: start } }).sort({ entryTime: -1 });
  }

  async getRecent(days = 30): Promise<PaperTradeDocument[]> {
    const from = new Date(Date.now() - days * 86_400_000);
    return this.paperModel.find({ entryTime: { $gte: from } }).sort({ entryTime: -1 });
  }

  async getSummary(days = 30) {
    const trades = await this.getRecent(days);
    const closed = trades.filter((t) => t.status === 'CLOSED' && t.netPnl != null);
    const wins = closed.filter((t) => (t.netPnl ?? 0) > 0);
    return {
      total: trades.length,
      open: trades.filter((t) => t.status === 'OPEN').length,
      closed: closed.length,
      wins: wins.length,
      winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
      netPnl: +closed.reduce((s, t) => s + (t.netPnl ?? 0), 0).toFixed(2),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private timeToExpiry(): number {
    const nowIST = new Date(Date.now() + 5.5 * 3_600_000);
    const dow = nowIST.getUTCDay();
    const daysToThursday = ((4 - dow + 7) % 7) || 7;
    const hoursLeft = 15.5 - (nowIST.getUTCHours() + nowIST.getUTCMinutes() / 60);
    return Math.max((daysToThursday - 1 + hoursLeft / 6.25) / 365, 1 / 365);
  }
}
