import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PortfolioBacktestService } from './portfolio-backtest.service';

@UseGuards(JwtAuthGuard)
@Controller('portfolio-backtest')
export class PortfolioBacktestController {
  constructor(private svc: PortfolioBacktestService) {}

  @Post('run')
  run(@CurrentUser() user: any, @Body() body: { fromDate: string; toDate: string; startingCapital?: number }) {
    return this.svc.run(user._id.toString(), body.fromDate, body.toDate, body.startingCapital ?? 100_000);
  }

  @Get('list')
  list(@CurrentUser() user: any) { return this.svc.list(user._id.toString()); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }
}
