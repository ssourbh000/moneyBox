import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IVCrushTradeDocument = IVCrushTrade & Document;

@Schema({ timestamps: true })
export class IVCrushTrade {
  @Prop({ required: true, unique: true }) date: string; // YYYY-MM-DD

  @Prop({ required: true, enum: ['WAITING', 'OPEN', 'CLOSED', 'SKIPPED'] })
  status: string;

  // Entry details
  @Prop() entryTime: Date;
  @Prop() spot: number;
  @Prop() strike: number;
  @Prop() entryStraddle: number;
  @Prop() lots: number;
  @Prop() vix: number;
  @Prop() gapPct: number;

  // Exit details
  @Prop() exitTime: Date;
  @Prop() exitStraddle: number;
  @Prop() exitReason: string; // TP | SL | TIME
  @Prop() grossPnl: number;
  @Prop() netPnl: number;

  // Skip reason (if status=SKIPPED)
  @Prop() skipReason: string;

  // Live tracking (updated each tick while OPEN)
  @Prop() currentStraddle: number;
  @Prop() currentPnl: number;
  @Prop() lastUpdated: Date;
}

export const IVCrushTradeSchema = SchemaFactory.createForClass(IVCrushTrade);
