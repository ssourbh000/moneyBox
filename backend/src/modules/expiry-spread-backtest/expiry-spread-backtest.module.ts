import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExpirySpreadBacktestService } from './expiry-spread-backtest.service';
import { ExpirySpreadBacktestController } from './expiry-spread-backtest.controller';
import { ExpirySpreadRun, ExpirySpreadRunSchema } from './schemas/expiry-spread-backtest-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: ExpirySpreadRun.name, schema: ExpirySpreadRunSchema }]), MarketDataModule],
  providers: [ExpirySpreadBacktestService],
  controllers: [ExpirySpreadBacktestController],
  exports: [ExpirySpreadBacktestService],
})
export class ExpirySpreadBacktestModule {}
