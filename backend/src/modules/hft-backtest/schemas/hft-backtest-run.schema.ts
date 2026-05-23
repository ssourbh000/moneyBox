import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type HftBacktestRunDocument = HftBacktestRun & Document;

export enum HBStatus {
  QUEUED    = 'QUEUED',
  RUNNING   = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED    = 'FAILED',
}

@Schema({ timestamps: true })
export class HftBacktestRun {
  @Prop({ type: Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) fromDate: Date;
  @Prop({ required: true }) toDate: Date;
  @Prop({ default: HBStatus.QUEUED }) status: string;
  @Prop() errorMessage?: string;
  @Prop({ type: Object }) metrics?: Record<string, any>;
  @Prop({ type: [Object], default: [] }) trades: Record<string, any>[];
}

export const HftBacktestRunSchema = SchemaFactory.createForClass(HftBacktestRun);
