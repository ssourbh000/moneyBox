import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument, AuditAction } from './schemas/audit-log.schema';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private auditModel: Model<AuditLogDocument>,
  ) {}

  async log(params: {
    userId: string;
    action: AuditAction;
    entityType?: string;
    entityId?: string;
    payload?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      await this.auditModel.create({
        userId: new Types.ObjectId(params.userId),
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        payload: params.payload,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
    } catch (err: any) {
      this.logger.error(`Audit log failed: ${err.message}`);
    }
  }

  async getLogs(userId: string, limit = 50): Promise<AuditLogDocument[]> {
    return this.auditModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async getLogsByAction(action: AuditAction, limit = 50): Promise<AuditLogDocument[]> {
    return this.auditModel
      .find({ action })
      .sort({ createdAt: -1 })
      .limit(limit);
  }
}
