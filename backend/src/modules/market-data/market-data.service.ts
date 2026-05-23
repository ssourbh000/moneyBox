import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Instrument, InstrumentDocument } from './schemas/instrument.schema';
import { MarketBar, MarketBarDocument } from './schemas/market-bar.schema';
import { KiteAdapterService } from '../broker/kite-adapter.service';
import { AngelOneAdapterService, ANGEL_LOOKBACK_DAYS, ANGEL_INTERVAL_MAP } from './angel-one.adapter';

export type CandleInterval =
  | 'minute' | '3minute' | '5minute' | '10minute' | '15minute'
  | '30minute' | '60minute' | 'day' | 'week' | 'month';

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    @InjectModel(Instrument.name) private instrumentModel: Model<InstrumentDocument>,
    @InjectModel(MarketBar.name) private barModel: Model<MarketBarDocument>,
    private kite: KiteAdapterService,
    private angelOne: AngelOneAdapterService,
  ) {}

  // ── Instrument master ─────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async scheduledInstrumentSync() {
    this.logger.log('Scheduled instrument sync starting');
    await this.syncInstruments(['NSE', 'BSE', 'NFO']);
  }

  async syncInstruments(exchanges: string[]): Promise<{ synced: number }> {
    this.logger.log(`Syncing instruments for: ${exchanges.join(', ')}`);
    let synced = 0;

    for (const exchange of exchanges) {
      try {
        const instruments = await this.kite.getInstruments(exchange);
        const ops = instruments.map((inst: any) => ({
          updateOne: {
            filter: { instrumentToken: String(inst.instrument_token) },
            update: {
              $set: {
                symbol: inst.tradingsymbol,
                exchange: inst.exchange,
                name: inst.name || inst.tradingsymbol,
                isin: inst.isin,
                instrumentType: inst.instrument_type,
                lotSize: inst.lot_size,
                tickSize: inst.tick_size,
                instrumentToken: String(inst.instrument_token),
              },
            },
            upsert: true,
          },
        }));

        if (ops.length) {
          await this.instrumentModel.bulkWrite(ops);
          synced += ops.length;
          this.logger.log(`${exchange}: upserted ${ops.length} instruments`);
        }
      } catch (err) {
        this.logger.error(`Failed syncing ${exchange}`, err);
      }
    }

    return { synced };
  }

  async searchInstruments(q: string, exchange?: string, limit = 20): Promise<InstrumentDocument[]> {
    const filter: Record<string, any> = {
      symbol: { $regex: q.toUpperCase(), $options: 'i' },
    };
    if (exchange) filter.exchange = exchange;
    return this.instrumentModel.find(filter).limit(limit).sort({ symbol: 1 });
  }

  async getInstrumentBySymbol(symbol: string, exchange: string): Promise<InstrumentDocument> {
    const inst = await this.instrumentModel.findOne({ symbol: symbol.toUpperCase(), exchange });
    if (!inst) throw new NotFoundException(`Instrument ${symbol}:${exchange} not found. Run instrument sync first.`);
    return inst;
  }

  // ── Candle / historical data ───────────────────────────────────────────────

  async fetchAndStore(
    accessToken: string,
    symbol: string,
    exchange: string,
    interval: CandleInterval,
    from: Date,
    to: Date,
  ): Promise<{ fetched: number; stored: number }> {
    const inst = await this.getInstrumentBySymbol(symbol, exchange);
    const raw = await this.kite.getHistoricalData(
      accessToken,
      parseInt(inst.instrumentToken, 10),
      interval,
      from,
      to,
    );

    if (!raw?.length) return { fetched: 0, stored: 0 };

    const ops = raw.map((candle: any) => ({
      updateOne: {
        filter: {
          symbol: symbol.toUpperCase(),
          exchange,
          interval,
          timestamp: new Date(candle.date),
        },
        update: {
          $set: {
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume ?? 0,
          },
        },
        upsert: true,
      },
    }));

    const result = await this.barModel.bulkWrite(ops);
    const stored = (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0);
    this.logger.log(`${symbol}:${exchange} ${interval} — fetched ${raw.length}, stored ${stored}`);
    return { fetched: raw.length, stored };
  }

  async getCandles(
    symbol: string,
    exchange: string,
    interval: CandleInterval,
    from: Date,
    to: Date,
  ): Promise<MarketBarDocument[]> {
    return this.barModel
      .find({
        symbol: symbol.toUpperCase(),
        exchange,
        interval,
        timestamp: { $gte: from, $lte: to },
      })
      .sort({ timestamp: 1 });
  }

  async getLatestCandle(
    symbol: string,
    exchange: string,
    interval: CandleInterval,
  ): Promise<MarketBarDocument | null> {
    return this.barModel
      .findOne({ symbol: symbol.toUpperCase(), exchange, interval })
      .sort({ timestamp: -1 });
  }

  async getCoverage(symbol: string, exchange: string, interval: CandleInterval) {
    const oldest = await this.barModel
      .findOne({ symbol: symbol.toUpperCase(), exchange, interval })
      .sort({ timestamp: 1 })
      .select('timestamp');
    const latest = await this.barModel
      .findOne({ symbol: symbol.toUpperCase(), exchange, interval })
      .sort({ timestamp: -1 })
      .select('timestamp');
    const count = await this.barModel.countDocuments({
      symbol: symbol.toUpperCase(),
      exchange,
      interval,
    });
    return { symbol, exchange, interval, count, oldest: oldest?.timestamp, latest: latest?.timestamp };
  }

  // ── Index data seeder (NIFTY 50, NIFTY BANK, INDIA VIX) ──────────────────────
  // Uses hardcoded NSE instrument tokens — bypasses instrument-lookup for indices.
  async seedIndexData(
    accessToken: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<{ series: string; fetched: number; stored: number; error?: string }[]> {
    const SERIES = [
      { symbol: 'NIFTY 50',   exchange: 'NSE', token: 256265,  intervals: ['5minute', '15minute', 'day'] as CandleInterval[] },
      { symbol: 'NIFTY BANK', exchange: 'NSE', token: 260105,  intervals: ['5minute', '15minute', 'day'] as CandleInterval[] },
      { symbol: 'INDIA VIX',  exchange: 'NSE', token: 264969,  intervals: ['day'] as CandleInterval[] },
    ];

    // Zerodha max range per request: 100 days for 5/15-min, 2000 days for day
    const MAX_DAYS: Record<string, number> = { '5minute': 100, '15minute': 100, 'day': 2000 };

    const results: { series: string; fetched: number; stored: number; error?: string }[] = [];

    for (const s of SERIES) {
      for (const interval of s.intervals) {
        const key = `${s.symbol}:${interval}`;
        let totalFetched = 0;
        let totalStored = 0;
        try {
          const chunkDays = MAX_DAYS[interval] ?? 100;
          let cursor = new Date(fromDate);
          while (cursor < toDate) {
            const chunkEnd = new Date(Math.min(cursor.getTime() + chunkDays * 86_400_000, toDate.getTime()));
            const raw = await this.kite.getHistoricalData(accessToken, s.token, interval, cursor, chunkEnd);
            if (raw?.length) {
              const ops = raw.map((c: any) => ({
                updateOne: {
                  filter: { symbol: s.symbol, exchange: s.exchange, interval, timestamp: new Date(c.date) },
                  update: { $set: { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 } },
                  upsert: true,
                },
              }));
              const res = await this.barModel.bulkWrite(ops);
              totalFetched += raw.length;
              totalStored += (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
            }
            cursor = new Date(chunkEnd.getTime() + 86_400_000);
            await new Promise((r) => setTimeout(r, 400)); // Kite rate limit
          }
          results.push({ series: key, fetched: totalFetched, stored: totalStored });
          this.logger.log(`Seeded ${key}: fetched=${totalFetched} stored=${totalStored}`);
        } catch (err: any) {
          this.logger.error(`seedIndexData failed for ${key}: ${err.message}`);
          results.push({ series: key, fetched: totalFetched, stored: totalStored, error: err.message });
        }
      }
    }
    return results;
  }

  // ── Angel One seed ────────────────────────────────────────────────────────

  async seedFromAngelOne(fromDate: Date, toDate: Date): Promise<{ series: string; fetched: number; stored: number; error?: string }[]> {
    const INSTRUMENTS = [
      { symbol: 'NIFTY 50',          exchange: 'NSE', token: '99926000', hasIntraday: true  },
      { symbol: 'NIFTY BANK',        exchange: 'NSE', token: '99926009', hasIntraday: true  },
      { symbol: 'INDIA VIX',         exchange: 'NSE', token: '99926017', hasIntraday: false },
      { symbol: 'NIFTY FIN SERVICE', exchange: 'NSE', token: '99926037', hasIntraday: true  },
      { symbol: 'NIFTY MIDCAP SELECT', exchange: 'NSE', token: '99926074', hasIntraday: true  },
    ];

    // Angel One intervals to seed for each instrument
    const INTERVALS_ALL     = ['ONE_DAY', 'FIVE_MINUTE', 'FIFTEEN_MINUTE'];
    const INTERVALS_DAY_ONLY = ['ONE_DAY'];

    const results: { series: string; fetched: number; stored: number; error?: string }[] = [];
    const now = new Date();

    for (const inst of INSTRUMENTS) {
      const intervals = inst.hasIntraday ? INTERVALS_ALL : INTERVALS_DAY_ONLY;

      for (const angelInterval of intervals) {
        const key = `${inst.symbol}:${ANGEL_INTERVAL_MAP[angelInterval]}`;
        let fetched = 0, stored = 0;
        try {
          // Clamp fromDate to the max lookback Angel One allows for this interval
          const maxLookback = ANGEL_LOOKBACK_DAYS[angelInterval];
          const earliest = new Date(now.getTime() - maxLookback * 86_400_000);
          const effectiveFrom = fromDate < earliest ? earliest : fromDate;

          if (effectiveFrom >= toDate) {
            results.push({ series: key, fetched: 0, stored: 0, error: 'Outside lookback window' });
            continue;
          }

          this.logger.log(`Seeding ${key} from ${effectiveFrom.toISOString().slice(0,10)} → ${toDate.toISOString().slice(0,10)}`);

          const candles = await this.angelOne.getCandles(
            inst.token, inst.exchange, angelInterval, effectiveFrom, toDate,
          );
          fetched = candles.length;

          if (candles.length) {
            const ops = candles.map((c) => ({
              updateOne: {
                filter: { symbol: inst.symbol, exchange: inst.exchange, interval: ANGEL_INTERVAL_MAP[angelInterval], timestamp: c.timestamp },
                update: { $set: { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume } },
                upsert: true,
              },
            }));
            const res = await this.barModel.bulkWrite(ops);
            stored = (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
          }

          this.logger.log(`${key}: fetched=${fetched} stored=${stored}`);
          results.push({ series: key, fetched, stored });

          await new Promise((r) => setTimeout(r, 300)); // Angel One rate limit
        } catch (err: any) {
          this.logger.error(`Angel One seed failed for ${key}: ${err.message}`);
          results.push({ series: key, fetched, stored, error: err.message });
        }
      }
    }
    return results;
  }

  async bulkFetchAndStore(
    accessToken: string,
    symbols: string[],
    exchange: string,
    interval: CandleInterval,
    from: Date,
    to: Date,
  ): Promise<{ symbol: string; fetched: number; stored: number; error?: string }[]> {
    const results: { symbol: string; fetched: number; stored: number; error?: string }[] = [];

    for (const symbol of symbols) {
      try {
        const result = await this.fetchAndStore(accessToken, symbol, exchange, interval, from, to);
        results.push({ symbol, ...result });
        // Respect Kite rate limit: ~3 req/s on historical API
        await new Promise((r) => setTimeout(r, 400));
      } catch (err: any) {
        this.logger.error(`Bulk fetch failed for ${symbol}`, err.message);
        results.push({ symbol, fetched: 0, stored: 0, error: err.message });
      }
    }

    return results;
  }
}
