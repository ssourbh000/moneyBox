import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { EventAlphaPaperService } from './event-alpha-paper.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('event-alpha-paper')
export class EventAlphaPaperController {
  constructor(private readonly svc: EventAlphaPaperService) {}

  @Get('today')
  getToday() { return this.svc.getToday(); }

  @Get('recent')
  getRecent(@Query('days') days?: string) {
    return this.svc.getRecent(days ? parseInt(days) : 30);
  }

  @Get('summary')
  getSummary(@Query('days') days?: string) {
    return this.svc.getSummary(days ? parseInt(days) : 30);
  }

  @Get('last-tick')
  getLastTick() { return this.svc.getLastTick(); }

  @Post('force-tick')
  forceTick() { return this.svc.forceTick(); }
}
