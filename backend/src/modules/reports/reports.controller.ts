import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('daily-pnl')
  getDailyPnl(@CurrentUser() user: any, @Query('days') days?: string) {
    return this.reportsService.getDailyPnlReport(user._id.toString(), days ? parseInt(days, 10) : 30);
  }

  @Get('monthly-summary')
  getMonthlySummary(@CurrentUser() user: any, @Query('months') months?: string) {
    return this.reportsService.getMonthlySummary(user._id.toString(), months ? parseInt(months, 10) : 6);
  }

  @Get('trade-journal')
  getTradeJournal(@CurrentUser() user: any, @Query('limit') limit?: string) {
    return this.reportsService.getTradeJournal(user._id.toString(), limit ? parseInt(limit, 10) : 100);
  }

  @Get('performance')
  getPerformanceSummary(@CurrentUser() user: any) {
    return this.reportsService.getPerformanceSummary(user._id.toString());
  }
}
