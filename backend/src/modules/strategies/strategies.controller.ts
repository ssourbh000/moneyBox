import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { StrategiesService } from './strategies.service';
import { StrategyEngineService } from './strategy-engine.service';
import { CreateStrategyDto, UpdateStrategyDto } from './dto/create-strategy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/schemas/audit-log.schema';

@ApiTags('strategies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('strategies')
export class StrategiesController {
  constructor(
    private strategiesService: StrategiesService,
    private engineService: StrategyEngineService,
    private auditService: AuditService,
  ) {}

  @Post()
  async create(@CurrentUser() user: any, @Body() dto: CreateStrategyDto) {
    const strategy = await this.strategiesService.create(user._id.toString(), dto);
    void this.auditService.log({ userId: user._id.toString(), action: AuditAction.STRATEGY_CREATED, entityId: String(strategy._id), payload: { name: dto.name } });
    return strategy;
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
  async update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateStrategyDto) {
    const strategy = await this.strategiesService.update(user._id.toString(), id, dto);
    void this.auditService.log({ userId: user._id.toString(), action: AuditAction.STRATEGY_UPDATED, entityId: id });
    return strategy;
  }

  @Post(':id/start')
  async start(@CurrentUser() user: any, @Param('id') id: string) {
    const strategy = await this.strategiesService.start(user._id.toString(), id);
    void this.auditService.log({ userId: user._id.toString(), action: AuditAction.STRATEGY_STARTED, entityId: id });
    return strategy;
  }

  @Post(':id/stop')
  async stop(@CurrentUser() user: any, @Param('id') id: string) {
    const strategy = await this.strategiesService.stop(user._id.toString(), id);
    void this.auditService.log({ userId: user._id.toString(), action: AuditAction.STRATEGY_STOPPED, entityId: id });
    return strategy;
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
