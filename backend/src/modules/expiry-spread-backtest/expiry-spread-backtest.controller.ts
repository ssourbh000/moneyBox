import { Controller, Post, Get, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExpirySpreadBacktestService } from './expiry-spread-backtest.service';

@UseGuards(JwtAuthGuard)
@Controller('expiry-spread-backtest')
export class ExpirySpreadBacktestController {
  constructor(private svc: ExpirySpreadBacktestService) {}

  @Post('run')
  run(@CurrentUser() user: any, @Body() body: { fromDate: string; toDate: string }) {
    return this.svc.run(user._id.toString(), body.fromDate, body.toDate);
  }

  @Get('list')
  list(@CurrentUser() user: any) { return this.svc.list(user._id.toString()); }

  @Get(':id')
  get(@Param('id') id: string) { return this.svc.get(id); }
}
