import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Position, PositionDocument } from '../portfolio/schemas/position.schema';
import { DailyPnl, DailyPnlDocument } from '../portfolio/schemas/daily-pnl.schema';
import { Order, OrderDocument } from '../execution/schemas/order.schema';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Position.name) private positionModel: Model<PositionDocument>,
    @InjectModel(DailyPnl.name) private dailyPnlModel: Model<DailyPnlDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
  ) {}

  async getDailyPnlReport(userId: string, days = 30): Promise<DailyPnlDocument[]> {
    const from = new Date();
    from.setDate(from.getDate() - days);
    return this.dailyPnlModel
      .find({
        userId: new Types.ObjectId(userId),
        date: { $gte: from.toISOString().slice(0, 10) },
      })
      .sort({ date: 1 });
  }

  async getMonthlySummary(userId: string, months = 6) {
    const from = new Date();
    from.setMonth(from.getMonth() - months);
    const daily = await this.dailyPnlModel
      .find({
        userId: new Types.ObjectId(userId),
        date: { $gte: from.toISOString().slice(0, 10) },
      })
      .sort({ date: 1 });

    // Group by YYYY-MM
    const grouped = new Map<string, { realizedPnl: number; totalTrades: number; wins: number; losses: number }>();
    for (const d of daily) {
      const key = d.date.slice(0, 7);
      const existing = grouped.get(key) ?? { realizedPnl: 0, totalTrades: 0, wins: 0, losses: 0 };
      grouped.set(key, {
        realizedPnl: existing.realizedPnl + d.realizedPnl,
        totalTrades: existing.totalTrades + d.totalTrades,
        wins: existing.wins + d.wins,
        losses: existing.losses + d.losses,
      });
    }

    return Array.from(grouped.entries()).map(([month, stats]) => ({
      month,
      ...stats,
      winRate: stats.totalTrades > 0 ? +((stats.wins / stats.totalTrades) * 100).toFixed(1) : 0,
    }));
  }

  async getTradeJournal(userId: string, limit = 100) {
    const positions = await this.positionModel
      .find({
        userId: new Types.ObjectId(userId),
        isClosed: true,
      })
      .sort({ closedAt: -1 })
      .limit(limit)
      .populate('strategyId', 'name');

    return positions.map((p) => ({
      _id: p._id,
      symbol: p.symbol,
      exchange: p.exchange,
      quantity: p.quantity,
      entryPrice: p.averageCost,
      exitPrice: p.lastPrice,
      realizedPnl: p.realizedPnl,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      holdingHours: p.openedAt && p.closedAt
        ? +((p.closedAt.getTime() - p.openedAt.getTime()) / 3_600_000).toFixed(1)
        : null,
      strategyName: (p.strategyId as any)?.name ?? '—',
      result: p.realizedPnl > 0 ? 'WIN' : p.realizedPnl < 0 ? 'LOSS' : 'BREAKEVEN',
    }));
  }

  async getPerformanceSummary(userId: string) {
    const uid = new Types.ObjectId(userId);

    const [allTrades, allDaily] = await Promise.all([
      this.positionModel.find({ userId: uid, isClosed: true }),
      this.dailyPnlModel.find({ userId: uid }).sort({ date: 1 }),
    ]);

    const wins = allTrades.filter((t) => t.realizedPnl > 0);
    const losses = allTrades.filter((t) => t.realizedPnl <= 0);
    const totalPnl = allTrades.reduce((s, t) => s + t.realizedPnl, 0);
    const grossProfit = wins.reduce((s, t) => s + t.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));

    // Best / worst trade
    const sorted = [...allTrades].sort((a, b) => b.realizedPnl - a.realizedPnl);
    const bestTrade = sorted[0] ?? null;
    const worstTrade = sorted[sorted.length - 1] ?? null;

    // Current streak
    let streak = 0;
    const streakType = allTrades.length > 0 && allTrades[allTrades.length - 1].realizedPnl > 0 ? 'WIN' : 'LOSS';
    for (let i = allTrades.length - 1; i >= 0; i--) {
      const isWin = allTrades[i].realizedPnl > 0;
      if ((streakType === 'WIN') === isWin) streak++;
      else break;
    }

    return {
      totalTrades: allTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: allTrades.length > 0 ? +((wins.length / allTrades.length) * 100).toFixed(1) : 0,
      totalPnl: +totalPnl.toFixed(2),
      grossProfit: +grossProfit.toFixed(2),
      grossLoss: +grossLoss.toFixed(2),
      profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : 0,
      avgWin: wins.length > 0 ? +(grossProfit / wins.length).toFixed(2) : 0,
      avgLoss: losses.length > 0 ? +(grossLoss / losses.length).toFixed(2) : 0,
      bestTrade: bestTrade ? { symbol: bestTrade.symbol, pnl: +bestTrade.realizedPnl.toFixed(2) } : null,
      worstTrade: worstTrade ? { symbol: worstTrade.symbol, pnl: +worstTrade.realizedPnl.toFixed(2) } : null,
      currentStreak: streak,
      streakType,
      tradingDays: allDaily.length,
    };
  }
}
