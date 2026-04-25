import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  SL = 'SL',
  SL_M = 'SL-M',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  COMPLETE = 'COMPLETE',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

export enum TradingMode {
  PAPER = 'paper',
  LIVE = 'live',
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Strategy' })
  strategyId: Types.ObjectId;

  @Prop({ type: String, enum: TradingMode, required: true })
  mode: TradingMode;

  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ type: String, enum: OrderSide, required: true })
  side: OrderSide;

  @Prop({ type: String, enum: OrderType, required: true })
  orderType: OrderType;

  @Prop({ required: true })
  quantity: number;

  @Prop()
  price: number;

  @Prop()
  triggerPrice: number;

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Prop()
  brokerOrderId: string;

  @Prop()
  averagePrice: number;

  @Prop({ default: 0 })
  filledQuantity: number;

  @Prop()
  rejectionReason: string;

  @Prop()
  signalId: string;

  @Prop({ type: Object, default: {} })
  meta: Record<string, unknown>;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
