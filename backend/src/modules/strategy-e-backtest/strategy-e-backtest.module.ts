import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketBar, MarketBarSchema } from '../market-data/schemas/market-bar.schema';
import { StrategyEBacktestController } from './strategy-e-backtest.controller';
import { StrategyEBacktestService } from './strategy-e-backtest.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: MarketBar.name, schema: MarketBarSchema }])],
  controllers: [StrategyEBacktestController],
  providers: [StrategyEBacktestService],
})
export class StrategyEBacktestModule {}
