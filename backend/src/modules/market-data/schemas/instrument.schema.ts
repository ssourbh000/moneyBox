import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InstrumentDocument = Instrument & Document;

@Schema({ timestamps: true })
export class Instrument {
  @Prop({ required: true })
  symbol: string;

  @Prop({ required: true })
  exchange: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  isin: string;

  @Prop()
  instrumentType: string;

  @Prop()
  lotSize: number;

  @Prop()
  tickSize: number;

  @Prop({ unique: true })
  instrumentToken: string;
}

export const InstrumentSchema = SchemaFactory.createForClass(Instrument);
InstrumentSchema.index({ symbol: 1, exchange: 1 }, { unique: true });
