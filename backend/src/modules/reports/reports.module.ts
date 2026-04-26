import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { Position, PositionSchema } from '../portfolio/schemas/position.schema';
import { DailyPnl, DailyPnlSchema } from '../portfolio/schemas/daily-pnl.schema';
import { Order, OrderSchema } from '../execution/schemas/order.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Position.name, schema: PositionSchema },
      { name: DailyPnl.name, schema: DailyPnlSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
