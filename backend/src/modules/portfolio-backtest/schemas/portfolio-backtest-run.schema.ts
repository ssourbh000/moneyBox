import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PortfolioRunDocument = PortfolioRun & Document;

export enum PFStatus { QUEUED = 'QUEUED', RUNNING = 'RUNNING', COMPLETED = 'COMPLETED', FAILED = 'FAILED' }

@Schema({ timestamps: true })
export class PortfolioRun {
  @Prop({ type: Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) fromDate: Date;
  @Prop({ required: true }) toDate: Date;
  @Prop({ required: true, default: 100000 }) startingCapital: number;
  @Prop({ default: PFStatus.QUEUED }) status: string;
  @Prop() errorMessage?: string;
  @Prop({ type: Object }) metrics?: Record<string, any>;
  @Prop({ type: [Object], default: [] }) trades: Record<string, any>[];
}

export const PortfolioRunSchema = SchemaFactory.createForClass(PortfolioRun);
