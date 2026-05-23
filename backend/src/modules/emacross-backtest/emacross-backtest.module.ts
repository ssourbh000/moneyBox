import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmacrossBacktestService } from './emacross-backtest.service';
import { EmacrossBacktestController } from './emacross-backtest.controller';
import { EmacrossBacktestRun, EmacrossBacktestRunSchema } from './schemas/emacross-backtest-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: EmacrossBacktestRun.name, schema: EmacrossBacktestRunSchema }]), MarketDataModule],
  providers: [EmacrossBacktestService],
  controllers: [EmacrossBacktestController],
  exports: [EmacrossBacktestService],
})
export class EmacrossBacktestModule {}
