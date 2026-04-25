import { Controller, Get, Post, Query, Redirect, UseGuards, Delete, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BrokerService } from './broker.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('broker')
export class BrokerController {
  private pendingOAuth = new Map<string, { userId: string; createdAt: number }>();
  private pendingCallback = new Map<string, { requestToken: string; createdAt: number }>();

  constructor(private brokerService: BrokerService) {
    // Cleanup old entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.pendingOAuth.entries()) {
        if (now - val.createdAt > 15 * 60 * 1000) { // 15 min timeout
          this.pendingOAuth.delete(key);
        }
      }
      for (const [key, val] of this.pendingCallback.entries()) {
        if (now - val.createdAt > 15 * 60 * 1000) { // 15 min timeout
          this.pendingCallback.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  @UseGuards(JwtAuthGuard)
  @Get('zerodha/login')
  getLoginUrl(@CurrentUser() user: any) {
    let url = this.brokerService.getLoginUrl();
    // Generate a token and store userId → token mapping
    const state = Math.random().toString(36).substring(7) + Date.now().toString(36);
    this.pendingOAuth.set(state, { userId: user._id.toString(), createdAt: Date.now() });

    console.log(`[LOGIN] Generated state: ${state.substring(0, 10)}..., userId: ${user._id}`);

    // Append state as query param to Kite login URL (Zerodha will pass it back in callback)
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}state=${encodeURIComponent(state)}`;

    return { url };
  }

  @Get('zerodha/callback')
  async handleCallbackRedirect(
    @Query('request_token') requestToken: string,
    @Query('status') status: string,
    @Res() res: any,
  ) {
    console.log('\n[CALLBACK] Incoming redirect from Kite');
    console.log(`  status: ${status}`);
    console.log(`  request_token: ${requestToken ? requestToken.substring(0, 20) + '...' : 'MISSING'}`);

    if (status !== 'success' || !requestToken) {
      console.log('[CALLBACK] ❌ Invalid status or missing request_token');
      return res.redirect(`${process.env.FRONTEND_URL}/settings?broker=error`);
    }

    // Store the request token temporarily using a unique key
    const callbackId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    this.pendingCallback.set(callbackId, { requestToken, createdAt: Date.now() });
    console.log(`[CALLBACK] Stored callback with ID: ${callbackId}`);

    // Redirect to frontend settings page with callback ID
    return res.redirect(`${process.env.FRONTEND_URL}/settings?kite_callback=${callbackId}`);
  }

  @UseGuards(JwtAuthGuard)
  @Post('zerodha/complete')
  async completeCallback(
    @CurrentUser() user: any,
    @Query('callback_id') callbackId: string,
  ) {
    console.log('\n[CALLBACK] Complete request from frontend');
    console.log(`  userId: ${user._id}`);
    console.log(`  callbackId: ${callbackId}`);

    if (!callbackId) {
      console.log('[CALLBACK] ❌ Missing callback_id');
      return { success: false, error: 'Missing callback_id' };
    }

    const pending = this.pendingCallback.get(callbackId);
    if (!pending) {
      console.log('[CALLBACK] ❌ Callback ID not found or expired');
      return { success: false, error: 'Callback expired or not found' };
    }

    const { requestToken } = pending;
    this.pendingCallback.delete(callbackId);

    try {
      console.log('[CALLBACK] Processing callback with requestToken...');
      await this.brokerService.handleCallback(user._id.toString(), requestToken);
      console.log('[CALLBACK] ✅ Success');
      return { success: true };
    } catch (err: any) {
      console.error('[CALLBACK] ❌ Error:', {
        message: err.message,
        code: err.code,
        response: err.response?.status,
      });
      return { success: false, error: err.message };
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus(@CurrentUser() user: any) {
    return this.brokerService.getStatus(user._id.toString());
  }

  @UseGuards(JwtAuthGuard)
  @Delete('disconnect')
  disconnect(@CurrentUser() user: any) {
    return this.brokerService.disconnect(user._id.toString());
  }

  @UseGuards(JwtAuthGuard)
  @Post('paper/init')
  async initPaperTrading(@CurrentUser() user: any) {
    console.log('\n[PAPER] Initializing paper trading for user:', user._id);
    try {
      const result = await this.brokerService.initPaperTrading(user._id.toString());
      console.log('[PAPER] ✅ Paper trading initialized');
      return { success: true, connected: true, broker: 'paper', clientId: result.clientId };
    } catch (err: any) {
      console.error('[PAPER] ❌ Error:', err.message);
      return { success: false, error: err.message };
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('paper/status')
  getPaperStatus(@CurrentUser() user: any) {
    return this.brokerService.getPaperStatus(user._id.toString());
  }
}
