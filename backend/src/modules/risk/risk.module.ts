import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';
import { RiskEvent, RiskEventSchema } from './schemas/risk-event.schema';
import { Position, PositionSchema } from '../portfolio/schemas/position.schema';
import { DailyPnl, DailyPnlSchema } from '../portfolio/schemas/daily-pnl.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RiskEvent.name, schema: RiskEventSchema },
      { name: Position.name, schema: PositionSchema },
      { name: DailyPnl.name, schema: DailyPnlSchema },
    ]),
  ],
  providers: [RiskService],
  controllers: [RiskController],
  exports: [RiskService],
})
export class RiskModule {}
