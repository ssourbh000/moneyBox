import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketBar, MarketBarSchema } from '../market-data/schemas/market-bar.schema';
import { OrbSimulatorController } from './orb-simulator.controller';
import { OrbSimulatorService } from './orb-simulator.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: MarketBar.name, schema: MarketBarSchema }])],
  controllers: [OrbSimulatorController],
  providers: [OrbSimulatorService],
})
export class OrbSimulatorModule {}
