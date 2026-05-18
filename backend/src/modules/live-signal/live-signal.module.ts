import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LiveSignalService } from './live-signal.service';
import { LiveSignalController } from './live-signal.controller';
import { PaperTrade, PaperTradeSchema } from './schemas/paper-trade.schema';
import { MarketDataModule } from '../market-data/market-data.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PaperTrade.name, schema: PaperTradeSchema }]),
    MarketDataModule,
  ],
  providers: [LiveSignalService],
  controllers: [LiveSignalController],
})
export class LiveSignalModule {}
