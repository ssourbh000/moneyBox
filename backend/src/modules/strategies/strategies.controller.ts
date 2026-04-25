import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Query,
} from '@nestjs/common';
import { StrategiesService } from './strategies.service';
import { StrategyEngineService } from './strategy-engine.service';
import { CreateStrategyDto, UpdateStrategyDto } from './dto/create-strategy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('strategies')
export class StrategiesController {
  constructor(
    private strategiesService: StrategiesService,
    private engineService: StrategyEngineService,
  ) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateStrategyDto) {
    return this.strategiesService.create(user._id.toString(), dto);
  }

  @Get()
  list(@CurrentUser() user: any) {
    return this.strategiesService.list(user._id.toString());
  }

  @Get(':id')
  get(@CurrentUser() user: any, @Param('id') id: string) {
    return this.strategiesService.get(user._id.toString(), id);
  }

  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateStrategyDto) {
    return this.strategiesService.update(user._id.toString(), id, dto);
  }

  @Post(':id/start')
  start(@CurrentUser() user: any, @Param('id') id: string) {
    return this.strategiesService.start(user._id.toString(), id);
  }

  @Post(':id/stop')
  stop(@CurrentUser() user: any, @Param('id') id: string) {
    return this.strategiesService.stop(user._id.toString(), id);
  }

  @Delete(':id')
  delete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.strategiesService.delete(user._id.toString(), id);
  }

  @Get(':id/signals')
  getSignals(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.strategiesService.getSignals(user._id.toString(), id, limit ? parseInt(limit, 10) : 50);
  }

  @Post('engine/run')
  manualRun(@CurrentUser() user: any) {
    return this.engineService.runManualCycle(user._id.toString());
  }
}
