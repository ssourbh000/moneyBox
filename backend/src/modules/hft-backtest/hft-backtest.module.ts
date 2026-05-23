import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HftBacktestService } from './hft-backtest.service';
import { HftBacktestController } from './hft-backtest.controller';
import { HftBacktestRun, HftBacktestRunSchema } from './schemas/hft-backtest-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: HftBacktestRun.name, schema: HftBacktestRunSchema }]),
    MarketDataModule,
  ],
  providers:   [HftBacktestService],
  controllers: [HftBacktestController],
  exports:     [HftBacktestService],
})
export class HftBacktestModule {}
