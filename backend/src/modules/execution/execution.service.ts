import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from './schemas/order.schema';

@Injectable()
export class ExecutionService {
  constructor(@InjectModel(Order.name) private orderModel: Model<OrderDocument>) {}

  async getOrders(userId: string, mode?: string, status?: string, limit = 100): Promise<OrderDocument[]> {
    const filter: Record<string, any> = { userId: new Types.ObjectId(userId) };
    if (mode) filter.mode = mode;
    if (status) filter.status = status;
    return this.orderModel.find(filter).sort({ createdAt: -1 }).limit(limit);
  }

}
