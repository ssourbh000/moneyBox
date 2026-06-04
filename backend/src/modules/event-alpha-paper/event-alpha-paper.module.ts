import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketBar, MarketBarSchema } from '../market-data/schemas/market-bar.schema';
import { EventAlphaTrade, EventAlphaTradeSchema } from './schemas/event-alpha-trade.schema';
import { EventAlphaPaperController } from './event-alpha-paper.controller';
import { EventAlphaPaperService } from './event-alpha-paper.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MarketBar.name,       schema: MarketBarSchema },
      { name: EventAlphaTrade.name, schema: EventAlphaTradeSchema },
    ]),
  ],
  controllers: [EventAlphaPaperController],
  providers:   [EventAlphaPaperService],
})
export class EventAlphaPaperModule {}
