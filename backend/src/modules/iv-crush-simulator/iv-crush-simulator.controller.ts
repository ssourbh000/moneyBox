import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IVCrushSimulatorService } from './iv-crush-simulator.service';
import type { IVCrushSimParams } from './iv-crush-simulator.service';

@UseGuards(JwtAuthGuard)
@Controller('iv-crush-simulator')
export class IVCrushSimulatorController {
  constructor(private readonly svc: IVCrushSimulatorService) {}

  @Post('run')
  run(@Body() params: IVCrushSimParams) {
    return this.svc.simulate(params);
  }
}
