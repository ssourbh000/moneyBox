import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BacktestRunDocument = BacktestRun & Document;

export enum BacktestStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class BacktestRun {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Strategy', required: true })
  strategyId: Types.ObjectId;

  @Prop({ required: true })
  fromDate: Date;

  @Prop({ required: true })
  toDate: Date;

  @Prop({ type: String, enum: BacktestStatus, default: BacktestStatus.QUEUED })
  status: BacktestStatus;

  @Prop({ type: Object, default: {} })
  parameters: Record<string, unknown>;

  @Prop({ type: Object })
  metrics: {
    totalTrades?: number;
    winRate?: number;
    profitFactor?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    netPnl?: number;
    avgWin?: number;
    avgLoss?: number;
    expectancy?: number;
  };

  @Prop({ type: [Object], default: [] })
  trades: Record<string, unknown>[];

  @Prop()
  errorMessage: string;

  @Prop()
  completedAt: Date;
}

export const BacktestRunSchema = SchemaFactory.createForClass(BacktestRun);
