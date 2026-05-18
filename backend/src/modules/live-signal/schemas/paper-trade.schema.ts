import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PaperTradeDocument = PaperTrade & Document;

@Schema({ timestamps: true })
export class PaperTrade {
  @Prop({ required: true }) symbol: string;
  @Prop({ required: true }) direction: string;   // CALL | PUT
  @Prop({ required: true }) strike: number;
  @Prop({ required: true }) entryPremium: number;
  @Prop({ required: true }) entryTime: Date;
  @Prop() exitPremium?: number;
  @Prop() exitTime?: Date;
  @Prop() exitReason?: string;                   // SL | TRAIL_SL | EOD | LIVE
  @Prop({ default: 'OPEN' }) status: string;     // OPEN | CLOSED
  @Prop({ required: true }) slPremium: number;
  @Prop({ required: true }) lots: number;
  @Prop({ required: true }) lotSize: number;
  @Prop() netPnl?: number;
  @Prop({ required: true }) vix: number;
  @Prop({ type: Object }) meta: Record<string, any>;
}

export const PaperTradeSchema = SchemaFactory.createForClass(PaperTrade);
