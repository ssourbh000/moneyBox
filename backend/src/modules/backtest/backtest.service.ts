import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BacktestRun, BacktestRunDocument, BacktestStatus } from './schemas/backtest-run.schema';
import { MarketDataService } from '../market-data/market-data.service';
import { StrategiesService, DEFAULT_PARAMS } from '../strategies/strategies.service';
import {
  ema, rsi, atr, adxSeries, upperBound, mean, stdDev, OHLCV,
} from '../strategies/indicators';
import { RunBacktestDto, CostConfigDto } from './dto/run-backtest.dto';

// ── Types ──────────────────────────────────────────────────────────────────────

interface OpenPosition {
  symbol: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  quantity: number;
  entryTime: Date;
  meta: Record<string, number | string>;
}

interface BacktestTrade {
  symbol: string;
  direction: 'LONG';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  quantity: number;
  exitReason: 'STOP' | 'TARGET' | 'EOD';
  grossPnl: number;
  costs: number;
  netPnl: number;
  capitalBefore: number;
  capitalAfter: number;
  meta: Record<string, number | string>;
}

interface EquityPoint {
  t: string;
  e: number;
}

interface BacktestResult {
  trades: BacktestTrade[];
  metrics: FullMetrics;
  inSampleMetrics: FullMetrics;
  outOfSampleMetrics: FullMetrics;
  equityCurve: EquityPoint[];
}

interface FullMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  roi: number;
  finalCapital: number;
  tradingDays: number;
  fromDate?: string;
  toDate?: string;
}

// ── Cost calculator ────────────────────────────────────────────────────────────

function tradeCost(
  entryPrice: number,
  exitPrice: number,
  qty: number,
  cfg: Required<CostConfigDto>,
): number {
  const entryNotional = entryPrice * qty;
  const exitNotional = exitPrice * qty;
  const brokBuy = Math.min(cfg.brokeragePerSide, entryNotional * cfg.brokerageRatePct / 100);
  const brokSell = Math.min(cfg.brokeragePerSide, exitNotional * cfg.brokerageRatePct / 100);
  const other = (entryNotional + exitNotional) * cfg.otherChargesPct / 100;
  return brokBuy + brokSell + other;
}

// ── Metrics calculator ─────────────────────────────────────────────────────────

function computeMetrics(
  trades: BacktestTrade[],
  initialCapital: number,
  fromDate: string,
  toDate: string,
): FullMetrics {
  if (!trades.length) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0, grossProfit: 0, grossLoss: 0,
      netPnl: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0, maxDrawdown: 0,
      maxDrawdownPct: 0, sharpeRatio: 0, sortinoRatio: 0, roi: 0, finalCapital: initialCapital,
      tradingDays: 0, fromDate, toDate,
    };
  }

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netPnl = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : 99.9;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = netPnl / trades.length;

  // Equity curve + drawdown
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  const equitySorted = [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime));
  for (const t of equitySorted) {
    equity += t.netPnl;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
  }
  const maxDrawdownPct = peakEquity > 0 ? (maxDrawdown / peakEquity) * 100 : 0;

  // Daily returns for Sharpe / Sortino
  const tradesByDay = new Map<string, number>();
  for (const t of trades) {
    const day = t.exitTime.slice(0, 10);
    tradesByDay.set(day, (tradesByDay.get(day) ?? 0) + t.netPnl);
  }
  const RISK_FREE_DAILY = 0.065 / 252;
  let runEquity = initialCapital;
  const dailyReturns: number[] = [];
  for (const [, dayPnl] of [...tradesByDay.entries()].sort()) {
    dailyReturns.push(dayPnl / runEquity - RISK_FREE_DAILY);
    runEquity += dayPnl;
  }
  const sharpeRatio =
    dailyReturns.length > 1
      ? +(mean(dailyReturns) / (stdDev(dailyReturns) || 1e-10) * Math.sqrt(252)).toFixed(2)
      : 0;
  const negReturns = dailyReturns.filter((r) => r < 0);
  const sortinoRatio =
    negReturns.length > 1
      ? +(mean(dailyReturns) / (stdDev(negReturns) || 1e-10) * Math.sqrt(252)).toFixed(2)
      : 0;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: +((wins.length / trades.length) * 100).toFixed(1),
    grossProfit: +grossProfit.toFixed(2),
    grossLoss: +grossLoss.toFixed(2),
    netPnl: +netPnl.toFixed(2),
    profitFactor,
    avgWin: +avgWin.toFixed(2),
    avgLoss: +avgLoss.toFixed(2),
    expectancy: +expectancy.toFixed(2),
    maxDrawdown: +maxDrawdown.toFixed(2),
    maxDrawdownPct: +maxDrawdownPct.toFixed(2),
    sharpeRatio,
    sortinoRatio,
    roi: +((netPnl / initialCapital) * 100).toFixed(2),
    finalCapital: +equity.toFixed(2),
    tradingDays: tradesByDay.size,
    fromDate,
    toDate,
  };
}

// ── Main service ───────────────────────────────────────────────────────────────

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    @InjectModel(BacktestRun.name) private runModel: Model<BacktestRunDocument>,
    private marketDataService: MarketDataService,
    private strategiesService: StrategiesService,
  ) {}

  async create(userId: string, dto: RunBacktestDto): Promise<BacktestRunDocument> {
    const strategy = await this.strategiesService.get(userId, dto.strategyId);

    const run = await this.runModel.create({
      userId: new Types.ObjectId(userId),
      strategyId: strategy._id,
      fromDate: new Date(dto.fromDate),
      toDate: new Date(dto.toDate),
      status: BacktestStatus.QUEUED,
      parameters: {
        ...strategy.parameters,
        inSampleRatio: dto.inSampleRatio ?? 0.7,
        costConfig: dto.costConfig ?? {},
      },
    });

    // Run asynchronously — do not await
    void this.executeBacktest(run._id.toString(), strategy, dto);
    return run;
  }

  async list(userId: string): Promise<BacktestRunDocument[]> {
    return this.runModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-trades');
  }

  async get(userId: string, id: string): Promise<BacktestRunDocument> {
    const run = await this.runModel.findById(id);
    if (!run) throw new NotFoundException('Backtest run not found');
    if (run.userId.toString() !== userId) throw new ForbiddenException();
    return run;
  }

  async delete(userId: string, id: string): Promise<void> {
    const run = await this.get(userId, id);
    await this.runModel.findByIdAndDelete(run._id);
  }

  // ── Core simulation ──────────────────────────────────────────────────────────

  private async executeBacktest(runId: string, strategy: any, dto: RunBacktestDto): Promise<void> {
    await this.runModel.findByIdAndUpdate(runId, { status: BacktestStatus.RUNNING });

    try {
      const params = { ...DEFAULT_PARAMS, ...strategy.parameters } as Record<string, number>;
      const initialCapital: number = params.paperCapital ?? 1_000_000;
      const inSampleRatio = dto.inSampleRatio ?? 0.7;
      const costCfg: Required<CostConfigDto> = {
        brokeragePerSide: dto.costConfig?.brokeragePerSide ?? 20,
        brokerageRatePct: dto.costConfig?.brokerageRatePct ?? 0.03,
        otherChargesPct: dto.costConfig?.otherChargesPct ?? 0.1,
      };

      const fromDate = new Date(dto.fromDate);
      const toDate = new Date(dto.toDate);

      // Walk-forward split
      const totalMs = toDate.getTime() - fromDate.getTime();
      const splitMs = fromDate.getTime() + totalMs * inSampleRatio;
      const splitDate = new Date(splitMs);

      this.logger.log(`Backtest ${runId}: ${strategy.universe.length} symbols, ${dto.fromDate} → ${dto.toDate}`);

      // Run simulation across all symbols (shared equity)
      const allTrades: BacktestTrade[] = [];
      let equity = initialCapital;

      for (const symbol of (strategy.universe as string[])) {
        const trades = await this.simulateSymbol(
          symbol,
          strategy.exchange as string,
          fromDate,
          toDate,
          params,
          equity,
          costCfg,
        );
        allTrades.push(...trades);
        // Update equity for next symbol's position sizing (cumulative)
        equity = trades.reduce((e, t) => e + t.netPnl, equity);
      }

      // Sort by entry time
      allTrades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));

      // Rebuild equity curve from scratch (shared)
      const equityCurve: EquityPoint[] = [];
      let runEq = initialCapital;
      for (const t of [...allTrades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) {
        runEq += t.netPnl;
        equityCurve.push({ t: t.exitTime.slice(0, 10), e: +runEq.toFixed(2) });
        t.capitalBefore = runEq - t.netPnl;
        t.capitalAfter = runEq;
      }

      // Metrics
      const allMetrics = computeMetrics(allTrades, initialCapital, dto.fromDate, dto.toDate);
      const inSampleTrades = allTrades.filter((t) => new Date(t.entryTime) < splitDate);
      const outTrades = allTrades.filter((t) => new Date(t.entryTime) >= splitDate);
      const inSampleMetrics = computeMetrics(inSampleTrades, initialCapital, dto.fromDate, splitDate.toISOString().slice(0, 10));
      const outOfSampleMetrics = computeMetrics(outTrades, initialCapital, splitDate.toISOString().slice(0, 10), dto.toDate);

      await this.runModel.findByIdAndUpdate(runId, {
        status: BacktestStatus.COMPLETED,
        completedAt: new Date(),
        metrics: { ...allMetrics, equityCurve, inSampleMetrics, outOfSampleMetrics },
        trades: allTrades,
      });

      this.logger.log(`Backtest ${runId} done — ${allTrades.length} trades, net P&L ₹${allMetrics.netPnl}`);
    } catch (err: any) {
      this.logger.error(`Backtest ${runId} failed: ${err.message}`, err.stack);
      await this.runModel.findByIdAndUpdate(runId, {
        status: BacktestStatus.FAILED,
        errorMessage: err.message,
      });
    }
  }

  private async simulateSymbol(
    symbol: string,
    exchange: string,
    fromDate: Date,
    toDate: Date,
    params: Record<string, number>,
    startEquity: number,
    costCfg: Required<CostConfigDto>,
  ): Promise<BacktestTrade[]> {
    // Load candles: 1 extra year of lookback so indicators are warm at fromDate
    const lookbackStart = new Date(fromDate);
    lookbackStart.setFullYear(lookbackStart.getFullYear() - 1);

    const [dayBars, hourBars, fiveMinBars] = await Promise.all([
      this.marketDataService.getCandles(symbol, exchange, 'day', lookbackStart, toDate),
      this.marketDataService.getCandles(symbol, exchange, '60minute', lookbackStart, toDate),
      this.marketDataService.getCandles(symbol, exchange, '5minute', fromDate, toDate),
    ]);

    const minDay = (params.dailyEma2 ?? 200) + 10;
    const minHour = (params.hourlyAdxPeriod ?? 14) * 2 + 10;
    const minFm = (params.entryEmaPeriod ?? 20) + 5;

    if (dayBars.length < minDay || hourBars.length < minHour || fiveMinBars.length < minFm) {
      this.logger.warn(`${symbol}: insufficient candles (day=${dayBars.length}, hour=${hourBars.length}, 5min=${fiveMinBars.length})`);
      return [];
    }

    // ── Pre-compute indicator series ─────────────────────────────────────────
    const dayCloses = dayBars.map((b) => b.close);
    const ema1Period = params.dailyEma1 ?? 50;
    const ema2Period = params.dailyEma2 ?? 200;
    const ema1 = ema(dayCloses, ema1Period);   // ema1[k] at dayBars[ema1Period-1+k]
    const ema2 = ema(dayCloses, ema2Period);   // ema2[k] at dayBars[ema2Period-1+k]
    const dayTs = dayBars.map((b) => b.timestamp.getTime());

    const hourOHLCV: OHLCV[] = hourBars.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const hourCloses = hourBars.map((b) => b.close);
    const hEmaP = params.hourlyEmaPeriod ?? 20;
    const hRsiP = params.hourlyRsiPeriod ?? 14;
    const hAdxP = params.hourlyAdxPeriod ?? 14;
    const hEma = ema(hourCloses, hEmaP);       // hEma[k] at hourBars[hEmaP-1+k]
    const hRsi = rsi(hourCloses, hRsiP);       // hRsi[k] at hourBars[hRsiP+k]
    const hAdx = adxSeries(hourOHLCV, hAdxP);  // hAdx[k] at hourBars[2*hAdxP+k]
    const hourTs = hourBars.map((b) => b.timestamp.getTime());

    const fmOHLCV: OHLCV[] = fiveMinBars.map((b) => ({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
    const fmCloses = fiveMinBars.map((b) => b.close);
    const fmVolumes = fiveMinBars.map((b) => b.volume);
    const fmEmaP = params.entryEmaPeriod ?? 20;
    const fmAtrP = params.entryAtrPeriod ?? 14;
    const fmEma = ema(fmCloses, fmEmaP);       // fmEma[k] at fiveMinBars[fmEmaP-1+k]
    const fmAtr = atr(fmOHLCV, fmAtrP);        // fmAtr[k] at fiveMinBars[fmAtrP+k]

    // ── Bar-by-bar scan ──────────────────────────────────────────────────────
    const trades: BacktestTrade[] = [];
    let openPos: OpenPosition | null = null;
    let equity = startEquity;
    const fmMinIdx = Math.max(fmEmaP, fmAtrP) + 2;

    for (let i = fmMinIdx; i < fiveMinBars.length; i++) {
      const bar = fiveMinBars[i];
      const barTimeMs = bar.timestamp.getTime();

      // ── Handle open position ─────────────────────────────────────────────
      if (openPos) {
        let exitPrice: number | null = null;
        let exitReason: 'STOP' | 'TARGET' | null = null;

        if (bar.low <= openPos.stopPrice) {
          exitPrice = openPos.stopPrice;
          exitReason = 'STOP';
        } else if (bar.high >= openPos.targetPrice) {
          exitPrice = openPos.targetPrice;
          exitReason = 'TARGET';
        }

        if (exitPrice !== null && exitReason !== null) {
          const grossPnl = (exitPrice - openPos.entryPrice) * openPos.quantity;
          const costs = tradeCost(openPos.entryPrice, exitPrice, openPos.quantity, costCfg);
          const netPnl = grossPnl - costs;
          equity += netPnl;
          trades.push({
            symbol,
            direction: 'LONG',
            entryTime: openPos.entryTime.toISOString(),
            exitTime: bar.timestamp.toISOString(),
            entryPrice: openPos.entryPrice,
            exitPrice,
            stopPrice: openPos.stopPrice,
            targetPrice: openPos.targetPrice,
            quantity: openPos.quantity,
            exitReason,
            grossPnl: +grossPnl.toFixed(2),
            costs: +costs.toFixed(2),
            netPnl: +netPnl.toFixed(2),
            capitalBefore: +(equity - netPnl).toFixed(2),
            capitalAfter: +equity.toFixed(2),
            meta: openPos.meta,
          });
          openPos = null;
        }
        continue;
      }

      // ── Regime check (daily) ─────────────────────────────────────────────
      // Find most recent daily bar whose timestamp < current bar
      const dIdx = upperBound(dayTs, barTimeMs) - 1;
      if (dIdx < ema2Period - 1) continue;
      const e1 = ema1[dIdx - (ema1Period - 1)];
      const e2 = ema2[dIdx - (ema2Period - 1)];
      if (!e1 || !e2) continue;
      if (!(dayCloses[dIdx] > e1 && e1 > e2)) continue;

      // ── Structure check (hourly) ─────────────────────────────────────────
      const hIdx = upperBound(hourTs, barTimeMs) - 1;
      const hAdxOffset = 2 * hAdxP;
      if (hIdx < Math.max(hEmaP - 1, hRsiP, hAdxOffset)) continue;
      const hEmaVal = hEma[hIdx - (hEmaP - 1)];
      const hRsiVal = hRsi[hIdx - hRsiP];
      const hAdxVal = hAdx[hIdx - hAdxOffset];
      if (!hEmaVal || !hRsiVal || !hAdxVal) continue;
      if (!(hourCloses[hIdx] > hEmaVal &&
            hAdxVal >= (params.hourlyAdxMin ?? 20) &&
            hRsiVal >= (params.hourlyRsiMin ?? 40) &&
            hRsiVal <= (params.hourlyRsiMax ?? 70))) continue;

      // ── Entry signal (5-min) ─────────────────────────────────────────────
      const fmEmaI = fmEma[i - (fmEmaP - 1)];
      const fmEmaPrev = fmEma[i - fmEmaP];
      const fmAtrI = fmAtr[i - fmAtrP];
      if (!fmEmaI || !fmEmaPrev || !fmAtrI) continue;

      const curClose = fmCloses[i];
      const prevClose = fmCloses[i - 1];
      const pullbackResume = prevClose <= fmEmaPrev && curClose > fmEmaI;
      if (!pullbackResume) continue;

      const volSlice = fmVolumes.slice(Math.max(0, i - fmEmaP), i);
      const avgVol = volSlice.reduce((a, b) => a + b, 0) / (volSlice.length || 1);
      const volRat = avgVol > 0 ? fmVolumes[i] / avgVol : 0;
      if (volRat < (params.entryVolumeRatioMin ?? 1.5)) continue;

      // ── Position sizing ──────────────────────────────────────────────────
      const entryPrice = curClose;
      const stopDistance = (params.stopAtrMultiplier ?? 1.5) * fmAtrI;
      if (stopDistance <= 0) continue;
      const stopPrice = entryPrice - stopDistance;
      const targetPrice = entryPrice + (params.targetRiskRatio ?? 2.0) * stopDistance;
      const riskAmount = equity * ((params.riskPercentPerTrade ?? 1.0) / 100);
      const quantity = Math.max(1, Math.floor(riskAmount / stopDistance));

      openPos = {
        symbol,
        entryPrice,
        stopPrice: +stopPrice.toFixed(2),
        targetPrice: +targetPrice.toFixed(2),
        quantity,
        entryTime: bar.timestamp,
        meta: {
          regime: 'BULLISH',
          dailyEma50: +e1.toFixed(2),
          dailyEma200: +e2.toFixed(2),
          hourlyAdx: +hAdxVal.toFixed(1),
          hourlyRsi: +hRsiVal.toFixed(1),
          entryAtr: +fmAtrI.toFixed(2),
          volumeRatio: +volRat.toFixed(2),
        },
      };
    }

    // Force-close any open position at end of range
    if (openPos && fiveMinBars.length > 0) {
      const lastBar = fiveMinBars[fiveMinBars.length - 1];
      const exitPrice = lastBar.close;
      const grossPnl = (exitPrice - openPos.entryPrice) * openPos.quantity;
      const costs = tradeCost(openPos.entryPrice, exitPrice, openPos.quantity, costCfg);
      const netPnl = grossPnl - costs;
      equity += netPnl;
      trades.push({
        symbol,
        direction: 'LONG',
        entryTime: openPos.entryTime.toISOString(),
        exitTime: lastBar.timestamp.toISOString(),
        entryPrice: openPos.entryPrice,
        exitPrice,
        stopPrice: openPos.stopPrice,
        targetPrice: openPos.targetPrice,
        quantity: openPos.quantity,
        exitReason: 'EOD',
        grossPnl: +grossPnl.toFixed(2),
        costs: +costs.toFixed(2),
        netPnl: +netPnl.toFixed(2),
        capitalBefore: +(equity - netPnl).toFixed(2),
        capitalAfter: +equity.toFixed(2),
        meta: openPos.meta,
      });
    }

    return trades;
  }
}
