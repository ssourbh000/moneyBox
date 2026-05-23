import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Orb15BacktestService } from './orb15-backtest.service';

@UseGuards(JwtAuthGuard)
@Controller('orb15-backtest')
export class Orb15BacktestController {
  constructor(private svc: Orb15BacktestService) {}

  @Post('run')
  run(@CurrentUser() user: any, @Body() body: { fromDate: string; toDate: string }) {
    return this.svc.run(user._id.toString(), body.fromDate, body.toDate);
  }

  @Get('list')
  list(@CurrentUser() user: any) { return this.svc.list(user._id.toString()); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }
}
