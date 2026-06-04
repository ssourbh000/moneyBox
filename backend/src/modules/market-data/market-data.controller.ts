import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { MarketDataService, CandleInterval } from './market-data.service';
import { BrokerService } from '../broker/broker.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FetchCandlesDto, GetCandlesQueryDto, SyncInstrumentsDto } from './dto/fetch-candles.dto';
import { BulkFetchDto } from './dto/bulk-fetch.dto';

@UseGuards(JwtAuthGuard)
@Controller('market-data')
export class MarketDataController {
  constructor(
    private marketDataService: MarketDataService,
    private brokerService: BrokerService,
  ) {}

  // ── Instruments ────────────────────────────────────────────────────────────

  @Post('instruments/sync')
  async syncInstruments(@Body() dto: SyncInstrumentsDto) {
    const exchanges = dto.exchanges ?? ['NSE', 'BSE', 'NFO'];
    return this.marketDataService.syncInstruments(exchanges);
  }

  @Get('instruments/search')
  searchInstruments(
    @Query('q') q: string,
    @Query('exchange') exchange?: string,
    @Query('limit') limit?: string,
  ) {
    if (!q || q.length < 1) throw new BadRequestException('q param required');
    return this.marketDataService.searchInstruments(q, exchange, limit ? parseInt(limit, 10) : 20);
  }

  // ── Candles ────────────────────────────────────────────────────────────────

  @Post('candles/fetch')
  async fetchAndStore(@CurrentUser() user: any, @Body() dto: FetchCandlesDto) {
    const accessToken = await this.brokerService.getValidAccessToken(user._id.toString());
    return this.marketDataService.fetchAndStore(
      accessToken,
      dto.symbol,
      dto.exchange,
      dto.interval as CandleInterval,
      new Date(dto.from),
      new Date(dto.to),
    );
  }

  @Get('candles')
  async getCandles(@Query() query: GetCandlesQueryDto) {
    return this.marketDataService.getCandles(
      query.symbol,
      query.exchange,
      query.interval as CandleInterval,
      new Date(query.from),
      new Date(query.to),
    );
  }

  @Get('candles/coverage')
  getCoverage(
    @Query('symbol') symbol: string,
    @Query('exchange') exchange: string,
    @Query('interval') interval: string,
  ) {
    return this.marketDataService.getCoverage(symbol, exchange, interval as CandleInterval);
  }

  @Post('seed-index')
  async seedIndex(
    @CurrentUser() user: any,
    @Body() body: { fromDate: string; toDate: string },
  ) {
    if (!body.fromDate || !body.toDate) throw new BadRequestException('fromDate and toDate required');
    const accessToken = await this.brokerService.getValidAccessToken(user._id.toString());
    return this.marketDataService.seedIndexData(accessToken, new Date(body.fromDate), new Date(body.toDate));
  }

  @Post('seed-angel')
  async seedAngel(@Body() body: { fromDate: string; toDate: string }) {
    if (!body.fromDate || !body.toDate) throw new BadRequestException('fromDate and toDate required');
    return this.marketDataService.seedFromAngelOne(new Date(body.fromDate), new Date(body.toDate));
  }

  @Post('force-intraday-seed')
  async forceIntradaySeed() {
    await this.marketDataService.scheduledIntradaySeed();
    return { triggered: true, time: new Date().toISOString() };
  }

  @Post('candles/bulk-fetch')
  async bulkFetch(@CurrentUser() user: any, @Body() dto: BulkFetchDto) {
    const accessToken = await this.brokerService.getValidAccessToken(user._id.toString());
    return this.marketDataService.bulkFetchAndStore(
      accessToken,
      dto.symbols,
      dto.exchange,
      dto.interval as CandleInterval,
      new Date(dto.from),
      new Date(dto.to),
    );
  }

  @Get('candles/latest')
  getLatest(
    @Query('symbol') symbol: string,
    @Query('exchange') exchange: string,
    @Query('interval') interval: string,
  ) {
    return this.marketDataService.getLatestCandle(symbol, exchange, interval as CandleInterval);
  }
}
