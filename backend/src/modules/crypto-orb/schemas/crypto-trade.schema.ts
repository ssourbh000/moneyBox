import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CryptoTradeDocument = CryptoTrade & Document;

@Schema({ timestamps: true })
export class CryptoTrade {
  @Prop({ required: true }) symbol: string;          // BTCUSDT | ETHUSDT
  @Prop({ required: true }) direction: string;       // LONG | SHORT
  @Prop({ required: true }) entryPrice: number;
  @Prop({ required: true }) entryTime: Date;
  @Prop() exitPrice?: number;
  @Prop() exitTime?: Date;
  @Prop() exitReason?: string;                       // SL | TRAIL_SL | EOD
  @Prop({ default: 'OPEN' }) status: string;         // OPEN | CLOSED
  @Prop({ required: true }) slPrice: number;
  @Prop({ required: true }) quantity: number;        // base asset units (e.g. BTC)
  @Prop() peakPrice?: number;
  @Prop({ default: false }) trailSL: boolean;
  @Prop({ default: false }) partialBooked: boolean;
  @Prop() netPnlUsdt?: number;
  @Prop() capitalBefore?: number;
  @Prop() capitalAfter?: number;
  @Prop() sessionKey?: string;                       // UTC date "2024-06-01"
  @Prop({ type: Object }) meta?: Record<string, any>;
}

export const CryptoTradeSchema = SchemaFactory.createForClass(CryptoTrade);
