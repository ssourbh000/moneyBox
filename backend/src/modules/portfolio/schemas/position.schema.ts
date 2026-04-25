import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PositionDocument = Position & Document;

@Schema({ timestamps: true })
export class Position {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Strategy' })
  strategyId: Types.ObjectId;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ required: true })
  mode: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ required: true })
  averageCost: number;

  @Prop({ default: 0 })
  lastPrice: number;

  @Prop({ default: 0 })
  unrealizedPnl: number;

  @Prop({ default: 0 })
  realizedPnl: number;

  @Prop()
  openedAt: Date;

  @Prop()
  closedAt: Date;

  @Prop({ default: false })
  isClosed: boolean;
}

export const PositionSchema = SchemaFactory.createForClass(Position);
