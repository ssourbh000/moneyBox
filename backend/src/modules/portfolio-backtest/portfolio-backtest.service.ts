import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PortfolioRun, PortfolioRunDocument, PFStatus } from './schemas/portfolio-backtest-run.schema';
import { Orb15BacktestService } from '../orb15-backtest/orb15-backtest.service';
import { ExpirySpreadBacktestService } from '../expiry-spread-backtest/expiry-spread-backtest.service';
import { EventAlphaBacktestService } from '../event-alpha-backtest/event-alpha-backtest.service';

type Strategy = 'ORB' | 'SPREAD' | 'EVENT';

interface PortfolioTrade {
  _strategy: Strategy;
  symbol: string;
  exitTime: string;
  entryTime: string;
  netPnl: number;
  lots: number;
  exitReason: string;
  [key: string]: any;
}

function mean(a: number[]) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function stdDev(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

@Injectable()
export class PortfolioBacktestService {
  private readonly logger = new Logger(PortfolioBacktestService.name);

  constructor(
    @InjectModel(PortfolioRun.name) private runModel: Model<PortfolioRunDocument>,
    private orbSvc: Orb15BacktestService,
    private spreadSvc: ExpirySpreadBacktestService,
    private eventSvc: EventAlphaBacktestService,
  ) {}

  async run(userId: string, fromDate: string, toDate: string, startingCapital = 100_000) {
    const record = await this.runModel.create({ userId: new Types.ObjectId(userId), fromDate: new Date(fromDate), toDate: new Date(toDate), startingCapital, status: PFStatus.QUEUED });
    void this.execute(record._id.toString(), fromDate, toDate, startingCapital);
    return record;
  }

  async get(id: string) { return this.runModel.findById(id); }

  async list(userId: string) {
    return this.runModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(10).select('-trades');
  }

  private async execute(runId: string, fromDate: string, toDate: string, startingCapital: number) {
    await this.runModel.findByIdAndUpdate(runId, { status: PFStatus.RUNNING });
    try {
      this.logger.log(`Portfolio backtest ${runId}: running all 3 strategies…`);

      const [orbTrades, spreadTrades, eventTrades] = await Promise.all([
        this.orbSvc.simulateTrades(fromDate, toDate),
        this.spreadSvc.simulateTrades(fromDate, toDate),
        this.eventSvc.simulateTrades(fromDate, toDate),
      ]);

      this.logger.log(`ORB: ${orbTrades.length} | Spread: ${spreadTrades.length} | Event: ${eventTrades.length}`);

      const allTrades: PortfolioTrade[] = [
        ...orbTrades,
        ...spreadTrades,
        ...eventTrades,
      ].sort((a, b) => a.exitTime.localeCompare(b.exitTime));

      const metrics = this.computePortfolioMetrics(allTrades, orbTrades, spreadTrades, eventTrades, startingCapital);

      await this.runModel.findByIdAndUpdate(runId, {
        status: PFStatus.COMPLETED,
        metrics,
        trades: allTrades.slice(-500), // store last 500 trades to keep doc size manageable
      });
    } catch (err: any) {
      this.logger.error(`Portfolio ${runId} failed: ${err.message}`);
      await this.runModel.findByIdAndUpdate(runId, { status: PFStatus.FAILED, errorMessage: err.message });
    }
  }

  private computePortfolioMetrics(
    all: PortfolioTrade[],
    orb: PortfolioTrade[],
    spread: PortfolioTrade[],
    event: PortfolioTrade[],
    startCap: number,
  ) {
    // ── Equity curve & drawdown ──────────────────────────────────────────────
    let equity = startCap, peak = startCap, maxDD = 0;
    const equityCurve: { t: string; e: number }[] = [];
    for (const t of all) {
      equity += t.netPnl;
      if (equity > peak) peak = equity;
      if (peak - equity > maxDD) maxDD = peak - equity;
      equityCurve.push({ t: t.exitTime.slice(0, 10), e: +equity.toFixed(2) });
    }

    // ── Daily P&L for Sharpe ─────────────────────────────────────────────────
    const dayPnl = new Map<string, number>();
    for (const t of all) dayPnl.set(t.exitTime.slice(0, 10), (dayPnl.get(t.exitTime.slice(0, 10)) ?? 0) + t.netPnl);
    const RFDR = 0.065 / 252;
    let re = startCap;
    const dr: number[] = [];
    for (const [, p] of [...dayPnl.entries()].sort()) { dr.push(p / re - RFDR); re += p; }
    const sharpe = dr.length > 1 ? +(mean(dr) / (stdDev(dr) || 1e-10) * Math.sqrt(252)).toFixed(2) : 0;

    // ── Monthly breakdown ────────────────────────────────────────────────────
    const monthly = new Map<string, { orb: number; spread: number; event: number; total: number; orbN: number; spreadN: number; eventN: number }>();
    for (const t of all) {
      const mo = t.exitTime.slice(0, 7);
      if (!monthly.has(mo)) monthly.set(mo, { orb: 0, spread: 0, event: 0, total: 0, orbN: 0, spreadN: 0, eventN: 0 });
      const row = monthly.get(mo)!;
      row.total += t.netPnl;
      if (t._strategy === 'ORB')    { row.orb    += t.netPnl; row.orbN++; }
      if (t._strategy === 'SPREAD') { row.spread  += t.netPnl; row.spreadN++; }
      if (t._strategy === 'EVENT')  { row.event   += t.netPnl; row.eventN++; }
    }
    const monthlyBreakdown = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mo, v]) => ({
      month: mo,
      orb:    +v.orb.toFixed(2),
      spread: +v.spread.toFixed(2),
      event:  +v.event.toFixed(2),
      total:  +v.total.toFixed(2),
      orbN: v.orbN, spreadN: v.spreadN, eventN: v.eventN,
    }));

    // ── Per-strategy stats ───────────────────────────────────────────────────
    const stratStats = (trades: PortfolioTrade[], label: Strategy) => {
      const wins = trades.filter(t => t.netPnl > 0), losses = trades.filter(t => t.netPnl <= 0);
      const gp = wins.reduce((s, t) => s + t.netPnl, 0);
      const gl = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
      return {
        strategy: label,
        trades: trades.length,
        winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
        netPnl: +(gp - gl).toFixed(2),
        avgWin: wins.length ? +(gp / wins.length).toFixed(2) : 0,
        avgLoss: losses.length ? +(gl / losses.length).toFixed(2) : 0,
        profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : 99,
        contribution: 0, // filled below
      };
    };

    const orbStats    = stratStats(orb as PortfolioTrade[], 'ORB');
    const spreadStats = stratStats(spread as PortfolioTrade[], 'SPREAD');
    const eventStats  = stratStats(event as PortfolioTrade[], 'EVENT');
    const totalNetPnl = orbStats.netPnl + spreadStats.netPnl + eventStats.netPnl;

    if (totalNetPnl !== 0) {
      orbStats.contribution    = +(orbStats.netPnl    / totalNetPnl * 100).toFixed(1);
      spreadStats.contribution = +(spreadStats.netPnl / totalNetPnl * 100).toFixed(1);
      eventStats.contribution  = +(eventStats.netPnl  / totalNetPnl * 100).toFixed(1);
    }

    // ── Combined top-level metrics ───────────────────────────────────────────
    const wins = all.filter(t => t.netPnl > 0), losses = all.filter(t => t.netPnl <= 0);
    const gp = wins.reduce((s, t) => s + t.netPnl, 0);
    const gl = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
    const winningMonths  = monthlyBreakdown.filter(m => m.total > 0).length;
    const losingMonths   = monthlyBreakdown.filter(m => m.total <= 0).length;
    const bestMonth      = monthlyBreakdown.reduce((best, m) => m.total > best.total ? m : best, { month: '', total: -Infinity });
    const worstMonth     = monthlyBreakdown.reduce((worst, m) => m.total < worst.total ? m : worst, { month: '', total: Infinity });

    return {
      totalTrades: all.length,
      wins: wins.length,
      losses: losses.length,
      winRate: +((wins.length / all.length) * 100).toFixed(1),
      netPnl: +(gp - gl).toFixed(2),
      grossProfit: +gp.toFixed(2),
      grossLoss: +gl.toFixed(2),
      profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : 99,
      avgWin: wins.length ? +(gp / wins.length).toFixed(2) : 0,
      avgLoss: losses.length ? +(gl / losses.length).toFixed(2) : 0,
      maxDrawdown: +maxDD.toFixed(2),
      sharpeRatio: sharpe,
      roi: +(((gp - gl) / startCap) * 100).toFixed(2),
      finalCapital: +(startCap + (gp - gl)).toFixed(2),
      startingCapital: startCap,
      // Monthly
      winningMonths, losingMonths,
      bestMonth:  { month: bestMonth.month,  pnl: +bestMonth.total.toFixed(2) },
      worstMonth: { month: worstMonth.month, pnl: +worstMonth.total.toFixed(2) },
      // Per strategy
      strategyStats: [orbStats, spreadStats, eventStats],
      monthlyBreakdown,
      equityCurve,
    };
  }
}
