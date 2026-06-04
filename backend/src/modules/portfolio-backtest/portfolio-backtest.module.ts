import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PortfolioBacktestService } from './portfolio-backtest.service';
import { PortfolioBacktestController } from './portfolio-backtest.controller';
import { PortfolioRun, PortfolioRunSchema } from './schemas/portfolio-backtest-run.schema';
import { Orb15BacktestModule } from '../orb15-backtest/orb15-backtest.module';
import { EventAlphaBacktestModule } from '../event-alpha-backtest/event-alpha-backtest.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PortfolioRun.name, schema: PortfolioRunSchema }]),
    Orb15BacktestModule,
    EventAlphaBacktestModule,
  ],
  providers: [PortfolioBacktestService],
  controllers: [PortfolioBacktestController],
})
export class PortfolioBacktestModule {}
