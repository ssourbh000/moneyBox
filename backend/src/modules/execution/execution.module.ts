import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExecutionService } from './execution.service';
import { ExecutionController } from './execution.controller';
import { PaperExecutionService } from './paper-execution.service';
import { Order, OrderSchema } from './schemas/order.schema';
import { PortfolioModule } from '../portfolio/portfolio.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    PortfolioModule,
  ],
  providers: [ExecutionService, PaperExecutionService],
  controllers: [ExecutionController],
  exports: [ExecutionService, PaperExecutionService],
})
export class ExecutionModule {}
