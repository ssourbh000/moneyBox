import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SimParams as OrbSimParams } from '../orb-simulator/orb-simulator.controller';
import { IVCrushSimParams } from '../iv-crush-simulator/iv-crush-simulator.service';
import { EventAlphaSimParams } from '../event-alpha-simulator/event-alpha-simulator.service';
import { UnifiedSimulatorService } from './unified-simulator.service';

export interface UnifiedSimParams {
  fromDate:   string;
  toDate:     string;
  capital:    number;
  strategies: {
    a?: OrbSimParams;
    b?: IVCrushSimParams;
    c?: EventAlphaSimParams;
  };
}

@UseGuards(JwtAuthGuard)
@Controller('unified-simulator')
export class UnifiedSimulatorController {
  constructor(private readonly svc: UnifiedSimulatorService) {}

  @Post('run')
  run(@Body() params: UnifiedSimParams) {
    return this.svc.run(params);
  }
}
