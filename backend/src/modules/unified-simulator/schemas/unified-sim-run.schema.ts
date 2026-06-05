import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UnifiedSimRunDocument = UnifiedSimRun & Document;

export enum USRStatus { COMPLETED = 'COMPLETED', FAILED = 'FAILED' }

@Schema({ timestamps: true })
export class UnifiedSimRun {
  @Prop({ type: Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) fromDate: Date;
  @Prop({ required: true }) toDate: Date;
  @Prop({ required: true }) capital: number;
  @Prop({ type: Object, required: true }) comboParams: Record<string, any>;
  @Prop({ default: USRStatus.COMPLETED }) status: string;
  @Prop({ type: Object }) results: Record<string, any>;
  @Prop() errorMessage?: string;
}

export const UnifiedSimRunSchema = SchemaFactory.createForClass(UnifiedSimRun);
