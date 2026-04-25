import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DailyPnlDocument = DailyPnl & Document;

@Schema()
export class DailyPnl {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  date: string;

  @Prop({ default: 0 })
  realizedPnl: number;

  @Prop({ default: 0 })
  unrealizedPnl: number;

  @Prop({ default: 0 })
  totalTrades: number;

  @Prop({ default: 0 })
  wins: number;

  @Prop({ default: 0 })
  losses: number;

  @Prop({ default: 0 })
  brokerage: number;
}

export const DailyPnlSchema = SchemaFactory.createForClass(DailyPnl);
DailyPnlSchema.index({ userId: 1, date: 1 }, { unique: true });
