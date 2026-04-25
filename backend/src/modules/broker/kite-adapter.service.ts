import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KiteConnect, Connect } from 'kiteconnect';

@Injectable()
export class KiteAdapterService {
  private readonly logger = new Logger(KiteAdapterService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('broker.kiteApiKey') ?? '';
    this.apiSecret = this.config.get<string>('broker.kiteApiSecret') ?? '';
  }

  buildClient(accessToken?: string): Connect {
    const kite = new KiteConnect({ api_key: this.apiKey });
    if (accessToken) kite.setAccessToken(accessToken);
    return kite;
  }

  getLoginUrl(): string {
    return this.buildClient().getLoginURL();
  }

  async generateSession(requestToken: string): Promise<{ accessToken: string; publicToken: string }> {
    const kite = this.buildClient();
    try {
      console.log('[KITE] generateSession called');
      console.log(`  apiKey: ${this.apiKey.substring(0, 10)}...`);
      console.log(`  apiSecret: ${this.apiSecret ? this.apiSecret.substring(0, 10) + '...' : 'MISSING'}`);
      console.log(`  requestToken: ${requestToken.substring(0, 20)}...`);

      const session = await kite.generateSession(requestToken, this.apiSecret);
      console.log('[KITE] ✅ Session generated successfully');
      console.log(`  access_token: ${session.access_token.substring(0, 20)}...`);

      return {
        accessToken: session.access_token,
        publicToken: session.public_token,
      };
    } catch (err: any) {
      console.error('[KITE] ❌ generateSession failed:', {
        message: err.message,
        code: err.code,
        response: err.response?.status,
        data: err.response?.data,
      });
      this.logger.error('generateSession failed', err);
      throw new UnauthorizedException('Failed to authenticate with Zerodha');
    }
  }

  async getProfile(accessToken: string) {
    return this.buildClient(accessToken).getProfile();
  }

  async getInstruments(exchange?: string): Promise<any[]> {
    const kite = this.buildClient();
    // Kite's getInstruments accepts a single exchange or array; the type only shows the array form
    return (exchange ? (kite.getInstruments as any)([exchange]) : kite.getInstruments()) as Promise<any[]>;
  }

  async getHistoricalData(
    accessToken: string,
    instrumentToken: number,
    interval: string,
    from: Date,
    to: Date,
    continuous = false,
  ): Promise<any[]> {
    const kite = this.buildClient(accessToken);
    const data = await (kite.getHistoricalData as any)(instrumentToken, interval, from, to, continuous);
    return data as any[];
  }

  async getQuote(accessToken: string, instruments: string[]): Promise<Record<string, any>> {
    const kite = this.buildClient(accessToken);
    return kite.getQuote(instruments) as any;
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }
}
