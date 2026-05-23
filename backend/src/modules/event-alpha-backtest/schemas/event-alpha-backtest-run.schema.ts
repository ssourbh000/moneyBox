import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EventAlphaRunDocument = EventAlphaRun & Document;

export enum EAStatus {
  QUEUED    = 'QUEUED',
  RUNNING   = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED    = 'FAILED',
}

@Schema({ timestamps: true })
export class EventAlphaRun {
  @Prop({ type: Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) fromDate: Date;
  @Prop({ required: true }) toDate: Date;
  @Prop({ default: EAStatus.QUEUED }) status: string;
  @Prop() errorMessage?: string;
  @Prop({ type: Object }) metrics?: Record<string, any>;
  @Prop({ type: [Object], default: [] }) trades: Record<string, any>[];
}

export const EventAlphaRunSchema = SchemaFactory.createForClass(EventAlphaRun);
