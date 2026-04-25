import {
  Controller, Post, Get, Delete, Param, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BacktestService } from './backtest.service';
import { RunBacktestDto } from './dto/run-backtest.dto';

@ApiTags('backtest')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('backtest')
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: RunBacktestDto) {
    return this.backtestService.create(user._id.toString(), dto);
  }

  @Get()
  list(@CurrentUser() user: any) {
    return this.backtestService.list(user._id.toString());
  }

  @Get(':id')
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.backtestService.get(user._id.toString(), id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: any, @Param('id') id: string) {
    await this.backtestService.delete(user._id.toString(), id);
  }
}
