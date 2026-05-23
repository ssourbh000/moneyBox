import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VwapScalpService } from './vwap-scalp.service';
import { VwapScalpController } from './vwap-scalp.controller';
import { VwapScalpRun, VwapScalpRunSchema } from './schemas/vwap-scalp-run.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: VwapScalpRun.name, schema: VwapScalpRunSchema }]), MarketDataModule],
  providers: [VwapScalpService],
  controllers: [VwapScalpController],
  exports: [VwapScalpService],
})
export class VwapScalpModule {}
