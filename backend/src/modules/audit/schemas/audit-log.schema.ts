import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

export enum AuditAction {
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  STRATEGY_CREATED = 'STRATEGY_CREATED',
  STRATEGY_UPDATED = 'STRATEGY_UPDATED',
  STRATEGY_STARTED = 'STRATEGY_STARTED',
  STRATEGY_STOPPED = 'STRATEGY_STOPPED',
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  RISK_LIMIT_BREACHED = 'RISK_LIMIT_BREACHED',
  KILL_SWITCH_ACTIVATED = 'KILL_SWITCH_ACTIVATED',
  MODE_SWITCHED = 'MODE_SWITCHED',
  BROKER_CONNECTED = 'BROKER_CONNECTED',
  BROKER_DISCONNECTED = 'BROKER_DISCONNECTED',
  CONFIG_CHANGED = 'CONFIG_CHANGED',
}

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: AuditAction, required: true })
  action: AuditAction;

  @Prop()
  entityType: string;

  @Prop()
  entityId: string;

  @Prop({ type: Object })
  payload: Record<string, unknown>;

  @Prop()
  ipAddress: string;

  @Prop()
  userAgent: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
