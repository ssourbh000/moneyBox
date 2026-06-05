import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrbSimulatorModule } from '../orb-simulator/orb-simulator.module';
import { IVCrushSimulatorModule } from '../iv-crush-simulator/iv-crush-simulator.module';
import { EventAlphaSimulatorModule } from '../event-alpha-simulator/event-alpha-simulator.module';
import { UnifiedSimulatorController } from './unified-simulator.controller';
import { UnifiedSimulatorService } from './unified-simulator.service';
import { UnifiedSimRun, UnifiedSimRunSchema } from './schemas/unified-sim-run.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UnifiedSimRun.name, schema: UnifiedSimRunSchema }]),
    OrbSimulatorModule,
    IVCrushSimulatorModule,
    EventAlphaSimulatorModule,
  ],
  controllers: [UnifiedSimulatorController],
  providers: [UnifiedSimulatorService],
})
export class UnifiedSimulatorModule {}
