import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StflipBacktestService } from './stflip-backtest.service';
import { StflipBacktestController } from './stflip-backtest.controller';
import { StflipBacktestRun, StflipBacktestRunSchema } from './schemas/stflip-backtest-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: StflipBacktestRun.name, schema: StflipBacktestRunSchema }]), MarketDataModule],
  providers: [StflipBacktestService],
  controllers: [StflipBacktestController],
  exports: [StflipBacktestService],
})
export class StflipBacktestModule {}
