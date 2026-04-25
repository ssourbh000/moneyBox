import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BrokerService } from './broker.service';
import { BrokerController } from './broker.controller';
import { KiteAdapterService } from './kite-adapter.service';
import { BrokerAccount, BrokerAccountSchema } from './schemas/broker-account.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: BrokerAccount.name, schema: BrokerAccountSchema }]),
  ],
  providers: [BrokerService, KiteAdapterService],
  controllers: [BrokerController],
  exports: [BrokerService, KiteAdapterService],
})
export class BrokerModule {}
