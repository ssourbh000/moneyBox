import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketBar, MarketBarSchema } from '../market-data/schemas/market-bar.schema';
import { IVCrushSimulatorController } from './iv-crush-simulator.controller';
import { IVCrushSimulatorService } from './iv-crush-simulator.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: MarketBar.name, schema: MarketBarSchema }])],
  controllers: [IVCrushSimulatorController],
  providers: [IVCrushSimulatorService],
  exports: [IVCrushSimulatorService],
})
export class IVCrushSimulatorModule {}
