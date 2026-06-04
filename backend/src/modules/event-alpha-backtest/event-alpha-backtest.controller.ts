import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EventAlphaBacktestService } from './event-alpha-backtest.service';

@UseGuards(JwtAuthGuard)
@Controller('event-alpha-backtest')
export class EventAlphaBacktestController {
  constructor(private svc: EventAlphaBacktestService) {}

  @Post('run')
  run(@CurrentUser() user: any, @Body() body: { fromDate: string; toDate: string; initialCapital?: number }) {
    return this.svc.run(user._id.toString(), body.fromDate, body.toDate, body.initialCapital);
  }

  @Get('list')
  list(@CurrentUser() user: any) { return this.svc.list(user._id.toString()); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }
}
