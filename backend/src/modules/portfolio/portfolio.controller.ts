import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('portfolio')
export class PortfolioController {
  constructor(private portfolioService: PortfolioService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: any) {
    return this.portfolioService.getTodaySummary(user._id.toString());
  }

  @Get('positions')
  getPositions(@CurrentUser() user: any, @Query('strategyId') strategyId?: string) {
    return this.portfolioService.getOpenPositions(user._id.toString(), strategyId);
  }

  @Get('positions/all')
  getAllPositions(@CurrentUser() user: any, @Query('limit') limit?: string) {
    return this.portfolioService.getAllPositions(user._id.toString(), limit ? parseInt(limit, 10) : 100);
  }

  @Get('pnl/daily')
  getDailyPnl(@CurrentUser() user: any, @Query('days') days?: string) {
    return this.portfolioService.getDailyPnl(user._id.toString(), days ? parseInt(days, 10) : 30);
  }
}
