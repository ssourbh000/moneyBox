import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrbSimulatorService } from './orb-simulator.service';

export interface SimParams {
  fromDate:       string;
  toDate:         string;
  capital:        number;
  slPct:          number;  // e.g. 0.12 = 12%
  trailTrigger:   number;  // e.g. 0.15 = activate after +15%
  trailPct:       number;  // e.g. 0.12 = trail 12% below peak
  smartCooldown:  boolean; // true = cooldown only after fixed SL, not after TRAIL_SL/EOD
  directionBlock: boolean; // true = block re-entry in same direction after SL hit
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
