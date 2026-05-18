import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as crypto from 'crypto';

const BASE_HOST = 'apiconnect.angelbroking.com';

// Angel One interval → our internal interval label
export const ANGEL_INTERVAL_MAP: Record<string, string> = {
  ONE_DAY:        'day',
  FIVE_MINUTE:    '5minute',
  FIFTEEN_MINUTE: '15minute',
};

// Max lookback in days per Angel One interval
export const ANGEL_LOOKBACK_DAYS: Record<string, number> = {
  ONE_DAY:        2000,
  FIVE_MINUTE:    100,
  FIFTEEN_MINUTE: 200,
};

export interface AngelCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Injectable()
export class AngelOneAdapterService {
  private readonly logger = new Logger(AngelOneAdapterService.name);
  private jwtToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(private config: ConfigService) {}

  // ── Low-level HTTP ─────────────────────────────────────────────────────────

  private request(path: string, body: object, authToken?: string): Promise<any> {
    const apiKey = this.config.get<string>('ANGEL_API_KEY')!;
    const payload = JSON.stringify(body);

    const headers: Record<string, string> = {
      'Content-Type':      'application/json',
      'Accept':            'application/json',
      'X-UserType':        'USER',
      'X-SourceID':        'WEB',
      'X-PrivateKey':      apiKey,
      'X-ClientLocalIP':   '192.168.1.1',
      'X-ClientPublicIP':  '49.43.3.78',
      'X-MACAddress':      '00:00:00:00:00:00',
      'Content-Length':    String(Buffer.byteLength(payload)),
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    return new Promise((resolve, reject) => {
      const req = https.request({ hostname: BASE_HOST, path, method: 'POST', headers }, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { reject(new Error(`Non-JSON response: ${raw.slice(0, 200)}`)); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // ── TOTP (RFC 6238) ────────────────────────────────────────────────────────

  private generateTOTP(base32Secret: string): string {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = base32Secret.toUpperCase().replace(/=+$/, '');
    const bytes: number[] = [];
    let bits = 0, value = 0;
    for (const c of clean) {
      value = (value << 5) | base32Chars.indexOf(c);
      bits += 5;
      if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 0xff); }
    }
    const key = Buffer.from(bytes);
    const epoch = Math.floor(Date.now() / 1000 / 30);
    const msg = Buffer.alloc(8);
    msg.writeUInt32BE(Math.floor(epoch / 0x100000000), 0);
    msg.writeUInt32BE(epoch >>> 0, 4);
    const hmac = crypto.createHmac('sha1', key).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(code % 1_000_000).padStart(6, '0');
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  async authenticate(): Promise<string> {
    if (this.jwtToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.jwtToken;
    }

    const totp = this.generateTOTP(this.config.get<string>('ANGEL_TOTP_SECRET')!);
    this.logger.log(`Authenticating with Angel One (TOTP: ${totp})`);

    const resp = await this.request('/rest/auth/angelbroking/user/v1/loginByPassword', {
      clientcode: this.config.get<string>('ANGEL_CLIENT_CODE'),
      password:   this.config.get<string>('ANGEL_PASSWORD'),
      totp,
    });

    if (!resp.status || !resp.data?.jwtToken) {
      throw new Error(`Angel One auth failed: ${resp.message || JSON.stringify(resp)}`);
    }

    this.jwtToken    = resp.data.jwtToken;
    this.tokenExpiry = new Date(Date.now() + 23 * 3_600_000); // reuse for 23 h
    this.logger.log('Angel One authenticated successfully');
    return this.jwtToken!;
  }

  // ── Historical candles ─────────────────────────────────────────────────────

  async getCandles(
    symboltoken: string,
    exchange: string,
    interval: string,  // ONE_DAY | FIVE_MINUTE | FIFTEEN_MINUTE
    from: Date,
    to: Date,
  ): Promise<AngelCandle[]> {
    const token = await this.authenticate();

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const resp = await this.request(
      '/rest/secure/angelbroking/historical/v1/getCandleData',
      { exchange, symboltoken, interval, fromdate: fmt(from), todate: fmt(to) },
      token,
    );

    if (!resp.status) {
      throw new Error(`Angel One getCandleData failed: ${resp.message}`);
    }

    const rows: any[][] = resp.data ?? [];
    return rows.map(([ts, o, h, l, c, v]) => ({
      timestamp: new Date(ts),
      open:  +o, high: +h, low: +l, close: +c, volume: +v,
    }));
  }
}
