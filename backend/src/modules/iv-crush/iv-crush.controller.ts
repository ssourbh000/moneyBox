import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { IVCrushService } from './iv-crush.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('iv-crush')
export class IVCrushController {
  constructor(private readonly svc: IVCrushService) {}

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

  @Post('backtest/run')
  runBacktest(
    @CurrentUser() user: any,
    @Body() body: { fromDate: string; toDate: string; initialCapital?: number },
  ) {
    return this.svc.runBacktest(
      user._id.toString(),
      body.fromDate,
      body.toDate,
      body.initialCapital ?? 100_000,
    );
  }
}
