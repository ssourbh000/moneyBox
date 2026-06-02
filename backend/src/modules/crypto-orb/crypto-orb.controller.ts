import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CryptoOrbService } from './crypto-orb.service';

@UseGuards(JwtAuthGuard)
@Controller('crypto-orb')
export class CryptoOrbController {
  constructor(private svc: CryptoOrbService) {}

  @Get('account')
  getAccount() { return this.svc.getAccount(); }

  @Get('today')
  getToday() { return this.svc.getToday(); }

  @Get('recent')
  getRecent(@Query('days') days?: string) {
    return this.svc.getRecent(days ? parseInt(days, 10) : 30);
  }

  @Post('force-tick')
  forceTick() { return this.svc.forceTick(); }

  @Post('close-all')
  closeAll() { return this.svc.closeAll(); }
}
