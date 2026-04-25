import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BrokerAccountDocument = BrokerAccount & Document;

export enum BrokerName {
  ZERODHA = 'zerodha',
  PAPER = 'paper',
}

export enum BrokerAccountStatus {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
}

@Schema({ timestamps: true })
export class BrokerAccount {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: BrokerName, required: true })
  broker: BrokerName;

  @Prop({ type: String, enum: BrokerAccountStatus, default: BrokerAccountStatus.DISCONNECTED })
  status: BrokerAccountStatus;

  @Prop({ select: false })
  accessToken: string;

  @Prop()
  tokenExpiresAt: Date;

  @Prop()
  clientId: string;

  @Prop({ default: false })
  isPaper: boolean;

  @Prop({ type: Object, default: {} })
  meta: Record<string, unknown>;
}

export const BrokerAccountSchema = SchemaFactory.createForClass(BrokerAccount);
