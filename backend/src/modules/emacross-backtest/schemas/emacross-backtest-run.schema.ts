import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EmacrossBacktestRunDocument = EmacrossBacktestRun & Document;

export enum ECStatus {
  QUEUED    = 'QUEUED',
  RUNNING   = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED    = 'FAILED',
}

@Schema({ timestamps: true })
export class EmacrossBacktestRun {
  @Prop({ type: Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) fromDate: Date;
  @Prop({ required: true }) toDate: Date;
  @Prop({ default: ECStatus.QUEUED }) status: string;
  @Prop() errorMessage?: string;
  @Prop({ type: Object }) metrics?: Record<string, any>;
  @Prop({ type: [Object], default: [] }) trades: Record<string, any>[];
}

export const EmacrossBacktestRunSchema = SchemaFactory.createForClass(EmacrossBacktestRun);
