import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketDataService } from './market-data.service';
import { MarketDataController } from './market-data.controller';
import { Instrument, InstrumentSchema } from './schemas/instrument.schema';
import { MarketBar, MarketBarSchema } from './schemas/market-bar.schema';
import { BrokerModule } from '../broker/broker.module';
import { AngelOneAdapterService } from './angel-one.adapter';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Instrument.name, schema: InstrumentSchema },
      { name: MarketBar.name, schema: MarketBarSchema },
    ]),
    BrokerModule,
  ],
  providers: [MarketDataService, AngelOneAdapterService],
  controllers: [MarketDataController],
  exports: [MarketDataService, AngelOneAdapterService],
})
export class MarketDataModule {}
