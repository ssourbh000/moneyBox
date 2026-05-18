import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OptionBacktestRunDocument = OptionBacktestRun & Document;

export enum OBStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class OptionBacktestRun {
  @Prop({ type: Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) fromDate: Date;
  @Prop({ required: true }) toDate: Date;
  @Prop({ default: OBStatus.QUEUED }) status: string;
  @Prop() errorMessage?: string;
  @Prop({ type: Object }) metrics?: Record<string, any>;
  @Prop({ type: [Object], default: [] }) trades: Record<string, any>[];
}

export const OptionBacktestRunSchema = SchemaFactory.createForClass(OptionBacktestRun);
