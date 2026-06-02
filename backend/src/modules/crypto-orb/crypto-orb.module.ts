import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CryptoOrbService } from './crypto-orb.service';
import { CryptoOrbController } from './crypto-orb.controller';
import { BinanceAdapter } from './binance.adapter';
import { CryptoTrade, CryptoTradeSchema } from './schemas/crypto-trade.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CryptoTrade.name, schema: CryptoTradeSchema }]),
  ],
  providers: [CryptoOrbService, BinanceAdapter],
  controllers: [CryptoOrbController],
})
export class CryptoOrbModule {}
