import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { BacktestRun, BacktestRunSchema } from './schemas/backtest-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';
import { StrategiesModule } from '../strategies/strategies.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: BacktestRun.name, schema: BacktestRunSchema }]),
    MarketDataModule,
    StrategiesModule,
  ],
  providers: [BacktestService],
  controllers: [BacktestController],
})
export class BacktestModule {}
