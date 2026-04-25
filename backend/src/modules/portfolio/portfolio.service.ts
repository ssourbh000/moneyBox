import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Position, PositionDocument } from './schemas/position.schema';
import { DailyPnl, DailyPnlDocument } from './schemas/daily-pnl.schema';

@Injectable()
export class PortfolioService {
  constructor(
    @InjectModel(Position.name) private positionModel: Model<PositionDocument>,
    @InjectModel(DailyPnl.name) private dailyPnlModel: Model<DailyPnlDocument>,
  ) {}

  async openPosition(params: {
    userId: string;
    strategyId: string;
    symbol: string;
    exchange: string;
    mode: string;
    quantity: number;
    entryPrice: number;
  }): Promise<PositionDocument> {
    return this.positionModel.create({
      userId: new Types.ObjectId(params.userId),
      strategyId: new Types.ObjectId(params.strategyId),
      symbol: params.symbol,
      exchange: params.exchange,
      mode: params.mode,
      quantity: params.quantity,
      averageCost: params.entryPrice,
      lastPrice: params.entryPrice,
      unrealizedPnl: 0,
      realizedPnl: 0,
      openedAt: new Date(),
      isClosed: false,
    });
  }

  async closePosition(positionId: string, exitPrice: number): Promise<PositionDocument> {
    const pos = await this.positionModel.findById(positionId);
    if (!pos) throw new Error(`Position ${positionId} not found`);
    const realized = (exitPrice - pos.averageCost) * pos.quantity;
    pos.realizedPnl = realized;
    pos.unrealizedPnl = 0;
    pos.lastPrice = exitPrice;
    pos.closedAt = new Date();
    pos.isClosed = true;
    await pos.save();
    await this.upsertDailyPnl(pos.userId.toString(), realized, realized >= 0);
    return pos;
  }

  async updateUnrealizedPnl(positionId: string, lastPrice: number): Promise<void> {
    const pos = await this.positionModel.findById(positionId);
    if (!pos || pos.isClosed) return;
    pos.lastPrice = lastPrice;
    pos.unrealizedPnl = (lastPrice - pos.averageCost) * pos.quantity;
    await pos.save();
  }

  async getOpenPositions(userId: string, strategyId?: string): Promise<PositionDocument[]> {
    const filter: Record<string, any> = {
      userId: new Types.ObjectId(userId),
      isClosed: false,
    };
    if (strategyId) filter.strategyId = new Types.ObjectId(strategyId);
    return this.positionModel.find(filter).sort({ openedAt: -1 });
  }

  async getAllPositions(userId: string, limit = 100): Promise<PositionDocument[]> {
    return this.positionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ openedAt: -1 })
      .limit(limit);
  }

  async getDailyPnl(userId: string, days = 30): Promise<DailyPnlDocument[]> {
    const from = new Date();
    from.setDate(from.getDate() - days);
    return this.dailyPnlModel
      .find({
        userId: new Types.ObjectId(userId),
        date: { $gte: from.toISOString().slice(0, 10) },
      })
      .sort({ date: 1 });
  }

  async getTodaySummary(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const pnl = await this.dailyPnlModel.findOne({ userId: new Types.ObjectId(userId), date: today });
    const openPositions = await this.positionModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isClosed: false,
    });
    const unrealized = await this.positionModel.aggregate([
      { $match: { userId: new Types.ObjectId(userId), isClosed: false } },
      { $group: { _id: null, total: { $sum: '$unrealizedPnl' } } },
    ]);
    return {
      date: today,
      realizedPnl: pnl?.realizedPnl ?? 0,
      unrealizedPnl: unrealized[0]?.total ?? 0,
      totalTrades: pnl?.totalTrades ?? 0,
      wins: pnl?.wins ?? 0,
      losses: pnl?.losses ?? 0,
      winRate: pnl?.totalTrades ? ((pnl.wins / pnl.totalTrades) * 100).toFixed(1) : '—',
      openPositions,
    };
  }

  private async upsertDailyPnl(userId: string, realizedDelta: number, isWin: boolean): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.dailyPnlModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId), date: today },
      {
        $inc: {
          realizedPnl: realizedDelta,
          totalTrades: 1,
          wins: isWin ? 1 : 0,
          losses: isWin ? 0 : 1,
        },
      },
      { upsert: true },
    );
  }
}
