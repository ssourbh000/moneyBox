import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VwapScalpRunDocument = VwapScalpRun & Document;

export enum VSStatus {
  QUEUED    = 'QUEUED',
  RUNNING   = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED    = 'FAILED',
}

@Schema({ timestamps: true })
export class VwapScalpRun {
  @Prop({ type: Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) fromDate: Date;
  @Prop({ required: true }) toDate: Date;
  @Prop({ default: VSStatus.QUEUED }) status: string;
  @Prop() errorMessage?: string;
  @Prop({ type: Object }) metrics?: Record<string, any>;
  @Prop({ type: [Object], default: [] }) trades: Record<string, any>[];
}

export const VwapScalpRunSchema = SchemaFactory.createForClass(VwapScalpRun);
