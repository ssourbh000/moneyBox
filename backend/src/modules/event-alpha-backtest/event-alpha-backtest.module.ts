import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventAlphaBacktestService } from './event-alpha-backtest.service';
import { EventAlphaRun, EventAlphaRunSchema } from './schemas/event-alpha-backtest-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: EventAlphaRun.name, schema: EventAlphaRunSchema }]), MarketDataModule],
  providers: [EventAlphaBacktestService],
  controllers: [],
  exports: [EventAlphaBacktestService],
})
export class EventAlphaBacktestModule {}
