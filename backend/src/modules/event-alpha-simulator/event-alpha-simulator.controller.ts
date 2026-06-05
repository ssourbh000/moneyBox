import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { EventAlphaSimulatorService } from './event-alpha-simulator.service';
import type { EventAlphaSimParams } from './event-alpha-simulator.service';

@UseGuards(JwtAuthGuard)
@Controller('event-alpha-simulator')
export class EventAlphaSimulatorController {
  constructor(private readonly svc: EventAlphaSimulatorService) {}

  @Post('run')
  run(@Body() params: EventAlphaSimParams) {
    return this.svc.simulate(params);
  }
}
