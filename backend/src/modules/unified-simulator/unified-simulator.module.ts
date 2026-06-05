import { Module } from '@nestjs/common';
import { OrbSimulatorModule } from '../orb-simulator/orb-simulator.module';
import { IVCrushSimulatorModule } from '../iv-crush-simulator/iv-crush-simulator.module';
import { EventAlphaSimulatorModule } from '../event-alpha-simulator/event-alpha-simulator.module';
import { UnifiedSimulatorController } from './unified-simulator.controller';
import { UnifiedSimulatorService } from './unified-simulator.service';

@Module({
  imports: [
    OrbSimulatorModule,
    IVCrushSimulatorModule,
    EventAlphaSimulatorModule,
  ],
  controllers: [UnifiedSimulatorController],
  providers: [UnifiedSimulatorService],
})
export class UnifiedSimulatorModule {}
