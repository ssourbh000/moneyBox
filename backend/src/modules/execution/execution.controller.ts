import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class ExecutionController {
  constructor(private executionService: ExecutionService) {}

  @Get()
  getOrders(
    @CurrentUser() user: any,
    @Query('mode') mode?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.executionService.getOrders(
      user._id.toString(),
      mode,
      status,
      limit ? parseInt(limit, 10) : 100,
    );
  }
}
