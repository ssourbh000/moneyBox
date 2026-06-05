import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketBar, MarketBarSchema } from '../market-data/schemas/market-bar.schema';
import { EventAlphaSimulatorController } from './event-alpha-simulator.controller';
import { EventAlphaSimulatorService } from './event-alpha-simulator.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: MarketBar.name, schema: MarketBarSchema }])],
  controllers: [EventAlphaSimulatorController],
  providers: [EventAlphaSimulatorService],
  exports: [EventAlphaSimulatorService],
})
export class EventAlphaSimulatorModule {}
