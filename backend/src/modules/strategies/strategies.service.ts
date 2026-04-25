import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Strategy, StrategyDocument, StrategyStatus, TradingMode } from './schemas/strategy.schema';
import { Signal, SignalDocument } from './schemas/signal.schema';
import { CreateStrategyDto, UpdateStrategyDto } from './dto/create-strategy.dto';

export const DEFAULT_PARAMS = {
  dailyEma1: 50,
  dailyEma2: 200,
  hourlyEmaPeriod: 20,
  hourlyAdxPeriod: 14,
  hourlyAdxMin: 20,
  hourlyRsiPeriod: 14,
  hourlyRsiMin: 40,
  hourlyRsiMax: 70,
  entryEmaPeriod: 20,
  entryAtrPeriod: 14,
  entryVolumeRatioMin: 1.5,
  stopAtrMultiplier: 1.5,
  targetRiskRatio: 2.0,
  riskPercentPerTrade: 1.0,
  paperCapital: 1_000_000,
};

@Injectable()
export class StrategiesService {
  constructor(
    @InjectModel(Strategy.name) private strategyModel: Model<StrategyDocument>,
    @InjectModel(Signal.name) private signalModel: Model<SignalDocument>,
  ) {}

  async create(userId: string, dto: CreateStrategyDto): Promise<StrategyDocument> {
    const strategy = new this.strategyModel({
      userId: new Types.ObjectId(userId),
      name: dto.name,
      description: dto.description,
      exchange: dto.exchange,
      universe: dto.universe.map((s) => s.toUpperCase()),
      parameters: { ...DEFAULT_PARAMS, ...(dto.parameters ?? {}) },
      riskLimits: {
        maxDailyLoss: dto.riskLimits?.maxDailyLoss ?? 5000,
        maxOpenPositions: dto.riskLimits?.maxOpenPositions ?? 3,
        maxPositionSize: dto.riskLimits?.maxPositionSize ?? 50000,
        paperCapital: dto.riskLimits?.paperCapital ?? 1_000_000,
        riskPercentPerTrade: dto.riskLimits?.riskPercentPerTrade ?? 1.0,
      },
      mode: TradingMode.PAPER,
      status: StrategyStatus.PAUSED,
    });
    return strategy.save();
  }

  async list(userId: string): Promise<StrategyDocument[]> {
    return this.strategyModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 });
  }

  async get(userId: string, id: string): Promise<StrategyDocument> {
    const s = await this.strategyModel.findById(id);
    if (!s) throw new NotFoundException('Strategy not found');
    if (s.userId.toString() !== userId) throw new ForbiddenException();
    return s;
  }

  async update(userId: string, id: string, dto: UpdateStrategyDto): Promise<StrategyDocument> {
    const s = await this.get(userId, id);
    if (dto.name) s.name = dto.name;
    if (dto.description !== undefined) s.description = dto.description;
    if (dto.universe) s.universe = dto.universe.map((sym) => sym.toUpperCase());
    if (dto.riskLimits) s.riskLimits = { ...s.riskLimits, ...dto.riskLimits } as any;
    if (dto.parameters) s.parameters = { ...s.parameters, ...dto.parameters };
    return s.save();
  }

  async start(userId: string, id: string): Promise<StrategyDocument> {
    const s = await this.get(userId, id);
    s.status = StrategyStatus.ACTIVE;
    return s.save();
  }

  async stop(userId: string, id: string): Promise<StrategyDocument> {
    const s = await this.get(userId, id);
    s.status = StrategyStatus.STOPPED;
    return s.save();
  }

  async delete(userId: string, id: string): Promise<void> {
    const s = await this.get(userId, id);
    await this.strategyModel.findByIdAndDelete(s._id);
  }

  async getActiveStrategies(): Promise<StrategyDocument[]> {
    return this.strategyModel.find({ status: StrategyStatus.ACTIVE });
  }

  async incrementStats(id: string, won: boolean): Promise<void> {
    const s = await this.strategyModel.findById(id);
    if (!s) return;
    const total = (s.totalTrades ?? 0) + 1;
    const prevWins = Math.round(((s.winRate ?? 0) / 100) * (total - 1));
    const wins = prevWins + (won ? 1 : 0);
    s.totalTrades = total;
    s.winRate = (wins / total) * 100;
    await s.save();
  }

  async getSignals(userId: string, strategyId: string, limit = 50): Promise<SignalDocument[]> {
    await this.get(userId, strategyId);
    return this.signalModel
      .find({ strategyId: new Types.ObjectId(strategyId) })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async saveSignal(signal: Partial<Signal>): Promise<SignalDocument> {
    return this.signalModel.create(signal);
  }
}
