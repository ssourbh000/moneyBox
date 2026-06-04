import { Controller, Post, Body, BadRequestException, UseGuards } from '@nestjs/common';
import { StrategyEBacktestService } from './strategy-e-backtest.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('strategy-e-backtest')
export class StrategyEBacktestController {
  constructor(private readonly svc: StrategyEBacktestService) {}

  @Post('run')
  async run(@Body() body: { fromDate: string; toDate: string }) {
    if (!body.fromDate || !body.toDate) throw new BadRequestException('fromDate and toDate required');
    return this.svc.runAll(new Date(body.fromDate), new Date(body.toDate));
  }
}
