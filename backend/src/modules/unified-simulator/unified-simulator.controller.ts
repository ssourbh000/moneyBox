import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SimParams as OrbSimParams } from '../orb-simulator/orb-simulator.controller';
import { IVCrushSimParams } from '../iv-crush-simulator/iv-crush-simulator.service';
import { EventAlphaSimParams } from '../event-alpha-simulator/event-alpha-simulator.service';
import { UnifiedSimulatorService } from './unified-simulator.service';

export interface UnifiedSimParams {
  fromDate:    string;
  toDate:      string;
  capital:     number;
  comboLabel?: string;
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
  run(@CurrentUser() user: any, @Body() params: UnifiedSimParams) {
    return this.svc.run(user._id.toString(), params);
  }

  @Get('list')
  list(@CurrentUser() user: any) {
    return this.svc.list(user._id.toString());
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }
}
