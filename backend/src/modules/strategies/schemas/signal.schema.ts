import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SignalDocument = Signal & Document;

export enum SignalDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum SignalStatus {
  EXECUTED = 'EXECUTED',
  EXPIRED = 'EXPIRED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true })
export class Signal {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Strategy', required: true })
  strategyId: Types.ObjectId;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ type: String, enum: SignalDirection, required: true })
  direction: SignalDirection;

  @Prop({ required: true })
  entryPrice: number;

  @Prop({ required: true })
  stopPrice: number;

  @Prop({ required: true })
  targetPrice: number;

  @Prop({ required: true })
  quantity: number;

  @Prop({ type: String, enum: SignalStatus, default: SignalStatus.EXECUTED })
  status: SignalStatus;

  @Prop({ default: 'paper' })
  mode: string;

  @Prop({ type: Object })
  meta: {
    regime?: string;
    dailyEma50?: number;
    dailyEma200?: number;
    hourlyAdx?: number;
    hourlyRsi?: number;
    entryAtr?: number;
    volumeRatio?: number;
    riskAmount?: number;
  };

  @Prop()
  orderId: string;

  @Prop()
  rejectionReason: string;
}

export const SignalSchema = SchemaFactory.createForClass(Signal);
SignalSchema.index({ strategyId: 1, createdAt: -1 });
SignalSchema.index({ userId: 1, createdAt: -1 });
