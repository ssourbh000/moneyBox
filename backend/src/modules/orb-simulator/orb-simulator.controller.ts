import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrbSimulatorService } from './orb-simulator.service';

export interface SimParams {
  fromDate:     string;
  toDate:       string;
  capital:      number;
  slPct:        number;  // e.g. 0.12 = 12%
  trailTrigger: number;  // e.g. 0.15 = activate after +15%
  trailPct:     number;  // e.g. 0.12 = trail 12% below peak
}

@UseGuards(JwtAuthGuard)
@Controller('orb-simulator')
export class OrbSimulatorController {
  constructor(private readonly svc: OrbSimulatorService) {}

  @Post('run')
  run(@Body() params: SimParams) {
    return this.svc.run(params);
  }
}
