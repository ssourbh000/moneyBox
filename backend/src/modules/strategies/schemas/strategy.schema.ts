import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type StrategyDocument = Strategy & Document;

export enum StrategyStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  STOPPED = 'stopped',
}

export enum TradingMode {
  PAPER = 'paper',
  LIVE = 'live',
}

@Schema({ timestamps: true })
export class Strategy {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  description: string;

  @Prop({ type: String, enum: StrategyStatus, default: StrategyStatus.PAUSED })
  status: StrategyStatus;

  @Prop({ type: String, enum: TradingMode, default: TradingMode.PAPER })
  mode: TradingMode;

  @Prop({ default: 'NSE' })
  exchange: string;

  @Prop({ type: [String], default: [] })
  universe: string[];

  @Prop({ type: Object, default: {} })
  parameters: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  riskLimits: {
    maxDailyLoss?: number;
    maxOpenPositions?: number;
    maxPositionSize?: number;
    maxExposurePercent?: number;
  };

  @Prop({ default: 0 })
  totalTrades: number;

  @Prop({ default: 0 })
  winRate: number;
}

export const StrategySchema = SchemaFactory.createForClass(Strategy);
