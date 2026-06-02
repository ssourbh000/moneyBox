import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LiveSignalService } from './live-signal.service';

@UseGuards(JwtAuthGuard)
@Controller('live-signal')
export class LiveSignalController {
  constructor(private svc: LiveSignalService) {}

  @Get('account')
  getAccount() { return this.svc.getAccount(); }

  @Get('today')
  getToday() { return this.svc.getToday(); }

  @Get('recent')
  getRecent(@Query('days') days?: string) { return this.svc.getRecent(days ? parseInt(days, 10) : 30); }

  @Get('summary')
  getSummary(@Query('days') days?: string) { return this.svc.getSummary(days ? parseInt(days, 10) : 30); }
}
