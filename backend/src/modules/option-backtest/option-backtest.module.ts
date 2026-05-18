import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OptionBacktestService } from './option-backtest.service';
import { OptionBacktestController } from './option-backtest.controller';
import { OptionBacktestRun, OptionBacktestRunSchema } from './schemas/option-backtest-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: OptionBacktestRun.name, schema: OptionBacktestRunSchema }]),
    MarketDataModule,
  ],
  providers: [OptionBacktestService],
  controllers: [OptionBacktestController],
  exports: [OptionBacktestService],
})
export class OptionBacktestModule {}
