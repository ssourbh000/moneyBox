import { Injectable, Logger } from '@nestjs/common';

const BASE = 'https://api.binance.com';

export interface BinanceKline {
  openTimeMs: number;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

@Injectable()
export class BinanceAdapter {
  private readonly logger = new Logger(BinanceAdapter.name);

  // Fetch up to `limit` klines ending now, or within [startTime, endTime] if provided
  async getKlines(
    symbol:     string,
    interval:   string,
    limit:      number,
    startTime?: number,
    endTime?:   number,
  ): Promise<BinanceKline[]> {
    const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
    if (startTime) params.set('startTime', String(startTime));
    if (endTime)   params.set('endTime',   String(endTime));

    const url = `${BASE}/api/v3/klines?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Binance ${symbol}/${interval}: HTTP ${res.status}`);

    const raw: any[][] = await res.json();
    return raw.map(r => ({
      openTimeMs: r[0] as number,
      open:   parseFloat(r[1]),
      high:   parseFloat(r[2]),
      low:    parseFloat(r[3]),
      close:  parseFloat(r[4]),
      volume: parseFloat(r[5]),
    }));
  }

  // Fetch all klines from a UTC date string (e.g. "2024-06-01") to now, paging if needed
  async getKlinesSinceDate(symbol: string, interval: string, utcDateKey: string): Promise<BinanceKline[]> {
    const startMs = new Date(utcDateKey + 'T00:00:00Z').getTime();
    const all: BinanceKline[] = [];
    let from = startMs;

    while (true) {
      const batch = await this.getKlines(symbol, interval, 1000, from, Date.now());
      if (!batch.length) break;
      all.push(...batch);
      const last = batch[batch.length - 1];
      // If we got fewer than 1000, we've reached the present
      if (batch.length < 1000) break;
      from = last.openTimeMs + 1;
    }
    return all;
  }

  // Fetch `limit` most-recent klines for rolling indicator calculation
  async getRolling(symbol: string, interval: string, limit = 200): Promise<BinanceKline[]> {
    return this.getKlines(symbol, interval, limit);
  }

  // Test connectivity
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/api/v3/ping`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
