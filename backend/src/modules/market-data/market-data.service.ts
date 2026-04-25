import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Instrument, InstrumentDocument } from './schemas/instrument.schema';
import { MarketBar, MarketBarDocument } from './schemas/market-bar.schema';
import { KiteAdapterService } from '../broker/kite-adapter.service';

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
