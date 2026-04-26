import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StrategiesService } from './strategies.service';
import { StrategiesController } from './strategies.controller';
import { StrategyEngineService } from './strategy-engine.service';
import { Strategy, StrategySchema } from './schemas/strategy.schema';
import { Signal, SignalSchema } from './schemas/signal.schema';
import { MarketDataModule } from '../market-data/market-data.module';
import { RiskModule } from '../risk/risk.module';
import { ExecutionModule } from '../execution/execution.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Strategy.name, schema: StrategySchema },
      { name: Signal.name, schema: SignalSchema },
    ]),
    MarketDataModule,
    RiskModule,
    ExecutionModule,
    PortfolioModule,
    AuditModule,
  ],
  providers: [StrategiesService, StrategyEngineService],
  controllers: [StrategiesController],
  exports: [StrategiesService],
})
export class StrategiesModule {}
