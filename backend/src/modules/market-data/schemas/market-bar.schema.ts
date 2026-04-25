import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MarketBarDocument = MarketBar & Document;

@Schema()
export class MarketBar {
  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ required: true })
  interval: string;

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ required: true })
  open: number;

  @Prop({ required: true })
  high: number;

  @Prop({ required: true })
  low: number;

  @Prop({ required: true })
  close: number;

  @Prop({ required: true, default: 0 })
  volume: number;
}

export const MarketBarSchema = SchemaFactory.createForClass(MarketBar);
MarketBarSchema.index({ symbol: 1, exchange: 1, interval: 1, timestamp: -1 }, { unique: true });
