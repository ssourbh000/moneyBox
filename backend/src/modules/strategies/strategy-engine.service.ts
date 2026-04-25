import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Types } from 'mongoose';
import {
  ema, atr, rsi, adx, volumeRatio, last,
  isMarketHours, isStale, OHLCV,
} from './indicators';
import { StrategiesService } from './strategies.service';
import { MarketDataService } from '../market-data/market-data.service';
import { RiskService } from '../risk/risk.service';
import { PaperExecutionService } from '../execution/paper-execution.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { StrategyDocument } from './schemas/strategy.schema';
import { SignalDirection, SignalStatus } from './schemas/signal.schema';
import { OrderSide } from '../execution/schemas/order.schema';

interface ScanResult {
  direction: SignalDirection;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  quantity: number;
  meta: {
    regime: string;
    dailyEma50: number;
    dailyEma200: number;
    hourlyAdx: number;
    hourlyRsi: number;
    entryAtr: number;
    volumeRatio: number;
    riskAmount: number;
  };
}

@Injectable()
export class StrategyEngineService {
  private readonly logger = new Logger(StrategyEngineService.name);

  constructor(
    private strategiesService: StrategiesService,
    private marketDataService: MarketDataService,
    private riskService: RiskService,
    private paperExecution: PaperExecutionService,
    private portfolioService: PortfolioService,
  ) {}

  // Runs every 5 minutes during Indian market hours (Mon-Fri, 9:15-15:30 IST)
  @Cron('*/5 3-10 * * 1-5', { timeZone: 'UTC' })
  async runScanCycle() {
    if (!isMarketHours()) return;
    const strategies = await this.strategiesService.getActiveStrategies();
    if (!strategies.length) return;
    this.logger.log(`Engine cycle: ${strategies.length} active strategy/ies`);
    for (const strategy of strategies) {
      await this.processStrategy(strategy).catch((err) =>
        this.logger.error(`Strategy ${strategy._id} error: ${err.message}`),
      );
    }
  }

  // Can also be triggered manually (for testing outside market hours)
  async runManualCycle(userId: string): Promise<{ processed: number; signals: number }> {
    const strategies = await this.strategiesService.getActiveStrategies();
    const userStrategies = strategies.filter((s) => s.userId.toString() === userId);
    let signals = 0;
    for (const s of userStrategies) {
      const n = await this.processStrategy(s);
      signals += n;
    }
    return { processed: userStrategies.length, signals };
  }

  private async processStrategy(strategy: StrategyDocument): Promise<number> {
    const userId = strategy.userId.toString();
    const strategyId = String(strategy._id);
    const params = strategy.parameters as Record<string, number>;
    const riskLimits = strategy.riskLimits as Record<string, number>;

    // 1. Monitor open positions first
    const latestCandles = await this.buildLatestCandleMap(strategy);
    const exits = await this.paperExecution.checkAndExitPositions(userId, strategyId, latestCandles);
    for (const exit of exits) {
      await this.strategiesService.incrementStats(strategyId, exit.won);
    }

    // 2. Scan universe for new signals
    let signalsGenerated = 0;
    for (const symbol of strategy.universe) {
      try {
        const signal = await this.scanSymbol(symbol, strategy.exchange as string, params, riskLimits);
        if (!signal) continue;

        // Check if already in position for this symbol
        const openPositions = await this.portfolioService.getOpenPositions(userId, strategyId);
        const alreadyOpen = openPositions.some((p) => p.symbol === symbol);
        if (alreadyOpen) continue;

        // Risk gate
        const orderValue = signal.entryPrice * signal.quantity;
        const riskCheck = await this.riskService.checkCanTrade(userId, strategyId, riskLimits, orderValue);
        if (!riskCheck.allowed) {
          await this.strategiesService.saveSignal({
            userId: new Types.ObjectId(userId),
            strategyId: new Types.ObjectId(strategyId),
            symbol,
            exchange: strategy.exchange as string,
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            stopPrice: signal.stopPrice,
            targetPrice: signal.targetPrice,
            quantity: signal.quantity,
            status: SignalStatus.REJECTED,
            mode: strategy.mode,
            meta: signal.meta,
            rejectionReason: riskCheck.reason,
          });
          continue;
        }

        // Place paper order
        const { order, positionId } = await this.paperExecution.placeOrder({
          userId,
          strategyId,
          symbol,
          exchange: strategy.exchange as string,
          side: OrderSide.BUY,
          quantity: signal.quantity,
          price: signal.entryPrice,
          stopPrice: signal.stopPrice,
          targetPrice: signal.targetPrice,
        });

        // Save signal record
        await this.strategiesService.saveSignal({
          userId: new Types.ObjectId(userId),
          strategyId: new Types.ObjectId(strategyId),
          symbol,
          exchange: strategy.exchange as string,
          direction: signal.direction,
          entryPrice: signal.entryPrice,
          stopPrice: signal.stopPrice,
          targetPrice: signal.targetPrice,
          quantity: signal.quantity,
          status: SignalStatus.EXECUTED,
          mode: strategy.mode,
          meta: signal.meta,
          orderId: String(order._id),
        });

        signalsGenerated++;
      } catch (err: any) {
        this.logger.warn(`scanSymbol ${symbol}: ${err.message}`);
      }
    }
    return signalsGenerated;
  }

  private async scanSymbol(
    symbol: string,
    exchange: string,
    params: Record<string, number>,
    riskLimits: Record<string, number>,
  ): Promise<ScanResult | null> {
    const now = new Date();
    const twoYearsAgo = new Date(now); twoYearsAgo.setFullYear(now.getFullYear() - 2);
    const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(now.getMonth() - 3);
    const oneMonthAgo = new Date(now); oneMonthAgo.setMonth(now.getMonth() - 1);

    // Fetch candles from MongoDB
    const [dayBars, hourBars, fiveMinBars] = await Promise.all([
      this.marketDataService.getCandles(symbol, exchange, 'day', twoYearsAgo, now),
      this.marketDataService.getCandles(symbol, exchange, '60minute', threeMonthsAgo, now),
      this.marketDataService.getCandles(symbol, exchange, '5minute', oneMonthAgo, now),
    ]);

    // Need sufficient data
    const minDailyBars = (params.dailyEma2 ?? 200) + 10;
    const minHourlyBars = (params.hourlyAdxPeriod ?? 14) * 3 + 10;
    const minFiveMinBars = (params.entryEmaPeriod ?? 20) + 10;

    if (dayBars.length < minDailyBars || hourBars.length < minHourlyBars || fiveMinBars.length < minFiveMinBars) {
      return null;
    }

    // Staleness check — latest 5-min candle should be recent
    if (isStale(fiveMinBars[fiveMinBars.length - 1].timestamp, 15)) return null;

    // ── Regime check (daily) ──────────────────────────────────────────────
    const dayCLoses = dayBars.map((b) => b.close);
    const dayEma1 = ema(dayCLoses, params.dailyEma1 ?? 50);
    const dayEma2 = ema(dayCLoses, params.dailyEma2 ?? 200);
    if (!dayEma1.length || !dayEma2.length) return null;

    const lastDayClose = last(dayCLoses);
    const lastEma1 = last(dayEma1);
    const lastEma2 = last(dayEma2);

    const isBullishRegime = lastDayClose > lastEma1 && lastEma1 > lastEma2;
    if (!isBullishRegime) return null;

    // ── Structure check (60-min) ─────────────────────────────────────────
    const hourCandles = hourBars.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const hourCloses = hourCandles.map((c) => c.close);

    const hourEma20 = ema(hourCloses, params.hourlyEmaPeriod ?? 20);
    const hourRsi14 = rsi(hourCloses, params.hourlyRsiPeriod ?? 14);
    const hourAdxVal = adx(hourCandles, params.hourlyAdxPeriod ?? 14);

    if (!hourEma20.length || !hourRsi14.length) return null;

    const lastHourClose = last(hourCloses);
    const lastHourEma = last(hourEma20);
    const lastHourRsi = last(hourRsi14);

    const aboveHourEma = lastHourClose > lastHourEma;
    const adxStrong = hourAdxVal >= (params.hourlyAdxMin ?? 20);
    const rsiInRange =
      lastHourRsi >= (params.hourlyRsiMin ?? 40) && lastHourRsi <= (params.hourlyRsiMax ?? 70);

    if (!aboveHourEma || !adxStrong || !rsiInRange) return null;

    // ── Entry signal (5-min) ─────────────────────────────────────────────
    const fmCandles = fiveMinBars.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const fmCloses = fmCandles.map((c) => c.close);
    const fmVolumes = fmCandles.map((c) => c.volume);

    const fmEma20 = ema(fmCloses, params.entryEmaPeriod ?? 20);
    const fmAtr14 = atr(fmCandles, params.entryAtrPeriod ?? 14);
    const volRatio = volumeRatio(fmVolumes, params.entryEmaPeriod ?? 20);

    if (!fmEma20.length || !fmAtr14.length) return null;

    const lastClose = fmCloses[fmCloses.length - 1];
    const prevClose = fmCloses[fmCloses.length - 2];
    const lastEma = fmEma20[fmEma20.length - 1];
    const prevEma = fmEma20[fmEma20.length - 2];
    const lastAtr = last(fmAtr14);

    // Pullback-and-resume: previous bar was at or below EMA, current bar crossed above
    const pullbackResume = prevClose <= prevEma && lastClose > lastEma;
    const volumeConfirmed = volRatio >= (params.entryVolumeRatioMin ?? 1.5);

    if (!pullbackResume || !volumeConfirmed) return null;

    // ── Position sizing ──────────────────────────────────────────────────
    const stopAtrMult = params.stopAtrMultiplier ?? 1.5;
    const targetRR = params.targetRiskRatio ?? 2.0;
    const riskPct = riskLimits.riskPercentPerTrade ?? 1.0;
    const capital = riskLimits.paperCapital ?? 1_000_000;

    const entryPrice = lastClose;
    const stopPrice = entryPrice - stopAtrMult * lastAtr;
    const stopDistance = entryPrice - stopPrice;
    if (stopDistance <= 0) return null;

    const targetPrice = entryPrice + targetRR * stopDistance;
    const riskAmount = capital * (riskPct / 100);
    const quantity = Math.max(1, Math.floor(riskAmount / stopDistance));

    return {
      direction: SignalDirection.LONG,
      entryPrice,
      stopPrice: Math.round(stopPrice * 100) / 100,
      targetPrice: Math.round(targetPrice * 100) / 100,
      quantity,
      meta: {
        regime: 'BULLISH',
        dailyEma50: Math.round(lastEma1 * 100) / 100,
        dailyEma200: Math.round(lastEma2 * 100) / 100,
        hourlyAdx: Math.round(hourAdxVal * 10) / 10,
        hourlyRsi: Math.round(lastHourRsi * 10) / 10,
        entryAtr: Math.round(lastAtr * 100) / 100,
        volumeRatio: Math.round(volRatio * 100) / 100,
        riskAmount: Math.round(riskAmount),
      },
    };
  }

  private async buildLatestCandleMap(
    strategy: StrategyDocument,
  ): Promise<Map<string, { high: number; low: number; close: number }>> {
    const map = new Map<string, { high: number; low: number; close: number }>();
    const exchange = strategy.exchange as string;
    for (const symbol of strategy.universe) {
      const bar = await this.marketDataService.getLatestCandle(symbol, exchange, '5minute');
      if (bar) map.set(`${symbol}:${exchange}`, { high: bar.high, low: bar.low, close: bar.close });
    }
    return map;
  }
}
