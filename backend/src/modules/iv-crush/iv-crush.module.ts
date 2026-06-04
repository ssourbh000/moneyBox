import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketBar, MarketBarSchema } from '../market-data/schemas/market-bar.schema';
import { IVCrushTrade, IVCrushTradeSchema } from './schemas/iv-crush-trade.schema';
import { IVCrushController } from './iv-crush.controller';
import { IVCrushService } from './iv-crush.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MarketBar.name,    schema: MarketBarSchema },
      { name: IVCrushTrade.name, schema: IVCrushTradeSchema },
    ]),
  ],
  controllers: [IVCrushController],
  providers:   [IVCrushService],
})
export class IVCrushModule {}
