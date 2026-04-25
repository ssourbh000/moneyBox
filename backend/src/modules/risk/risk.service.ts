import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RiskEvent, RiskEventDocument, RiskEventType } from './schemas/risk-event.schema';
import { DailyPnl, DailyPnlDocument } from '../portfolio/schemas/daily-pnl.schema';
import { Position, PositionDocument } from '../portfolio/schemas/position.schema';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);
  private killSwitchActive = false;

  constructor(
    @InjectModel(RiskEvent.name) private riskEventModel: Model<RiskEventDocument>,
    @InjectModel(DailyPnl.name) private dailyPnlModel: Model<DailyPnlDocument>,
    @InjectModel(Position.name) private positionModel: Model<PositionDocument>,
  ) {}

  async checkCanTrade(
    userId: string,
    strategyId: string,
    riskLimits: {
      maxDailyLoss?: number;
      maxOpenPositions?: number;
      maxPositionSize?: number;
    },
    orderValue: number,
  ): Promise<RiskCheckResult> {
    if (this.killSwitchActive) {
      return { allowed: false, reason: 'Kill switch is active' };
    }

    const today = new Date().toISOString().slice(0, 10);
    const uid = new Types.ObjectId(userId);

    // Max daily loss check
    if (riskLimits.maxDailyLoss) {
      const pnl = await this.dailyPnlModel.findOne({ userId: uid, date: today });
      const todayLoss = Math.abs(Math.min(0, pnl?.realizedPnl ?? 0));
      if (todayLoss >= riskLimits.maxDailyLoss) {
        await this.logEvent(userId, strategyId, RiskEventType.MAX_DAILY_LOSS, `Daily loss ₹${todayLoss} >= limit ₹${riskLimits.maxDailyLoss}`);
        return { allowed: false, reason: `Max daily loss reached (₹${riskLimits.maxDailyLoss})` };
      }
    }

    // Max open positions check
    if (riskLimits.maxOpenPositions) {
      const openCount = await this.positionModel.countDocuments({
        userId: uid,
        strategyId: new Types.ObjectId(strategyId),
        isClosed: false,
      });
      if (openCount >= riskLimits.maxOpenPositions) {
        await this.logEvent(userId, strategyId, RiskEventType.MAX_POSITIONS, `Open positions ${openCount} >= limit ${riskLimits.maxOpenPositions}`);
        return { allowed: false, reason: `Max open positions reached (${riskLimits.maxOpenPositions})` };
      }
    }

    // Max position size check
    if (riskLimits.maxPositionSize && orderValue > riskLimits.maxPositionSize) {
      return { allowed: false, reason: `Order value ₹${orderValue.toFixed(0)} exceeds max position size ₹${riskLimits.maxPositionSize}` };
    }

    return { allowed: true };
  }

  activateKillSwitch(userId: string): void {
    this.killSwitchActive = true;
    this.logger.warn(`KILL SWITCH ACTIVATED by user ${userId}`);
    void this.logEvent(userId, null, RiskEventType.KILL_SWITCH, 'Kill switch manually activated', true);
  }

  deactivateKillSwitch(): void {
    this.killSwitchActive = false;
    this.logger.log('Kill switch deactivated');
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  async getRecentEvents(userId: string, limit = 50): Promise<RiskEventDocument[]> {
    return this.riskEventModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  private async logEvent(
    userId: string,
    strategyId: string | null,
    eventType: RiskEventType,
    message: string,
    halted = false,
  ): Promise<void> {
    await this.riskEventModel.create({
      userId: new Types.ObjectId(userId),
      strategyId: strategyId ? new Types.ObjectId(strategyId) : undefined,
      eventType,
      message,
      halted,
    });
  }
}
