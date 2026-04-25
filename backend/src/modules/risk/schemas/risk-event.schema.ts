import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RiskEventDocument = RiskEvent & Document;

export enum RiskEventType {
  MAX_DAILY_LOSS = 'MAX_DAILY_LOSS',
  MAX_POSITIONS = 'MAX_POSITIONS',
  MAX_EXPOSURE = 'MAX_EXPOSURE',
  KILL_SWITCH = 'KILL_SWITCH',
  STALE_DATA = 'STALE_DATA',
  BROKER_ERROR = 'BROKER_ERROR',
}

@Schema({ timestamps: true })
export class RiskEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Strategy' })
  strategyId: Types.ObjectId;

  @Prop({ type: String, enum: RiskEventType, required: true })
  eventType: RiskEventType;

  @Prop({ required: true })
  message: string;

  @Prop({ type: Object })
  context: Record<string, unknown>;

  @Prop({ default: false })
  halted: boolean;
}

export const RiskEventSchema = SchemaFactory.createForClass(RiskEvent);
RiskEventSchema.index({ userId: 1, createdAt: -1 });
