import { Controller, Get, Post, Delete, UseGuards } from '@nestjs/common';
import { RiskService } from './risk.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('risk')
export class RiskController {
  constructor(private riskService: RiskService) {}

  @Get('status')
  getStatus() {
    return { killSwitchActive: this.riskService.isKillSwitchActive() };
  }

  @Post('kill-switch/activate')
  activateKillSwitch(@CurrentUser() user: any) {
    this.riskService.activateKillSwitch(user._id.toString());
    return { activated: true, message: 'Kill switch activated. All new orders will be rejected.' };
  }

  @Delete('kill-switch')
  deactivateKillSwitch() {
    this.riskService.deactivateKillSwitch();
    return { activated: false, message: 'Kill switch deactivated.' };
  }

  @Get('events')
  getEvents(@CurrentUser() user: any) {
    return this.riskService.getRecentEvents(user._id.toString());
  }
}
