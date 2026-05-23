import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Orb15BacktestService } from './orb15-backtest.service';
import { Orb15BacktestController } from './orb15-backtest.controller';
import { Orb15BacktestRun, Orb15BacktestRunSchema } from './schemas/orb15-backtest-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: Orb15BacktestRun.name, schema: Orb15BacktestRunSchema }]), MarketDataModule],
  providers: [Orb15BacktestService],
  controllers: [Orb15BacktestController],
  exports: [Orb15BacktestService],
})
export class Orb15BacktestModule {}
