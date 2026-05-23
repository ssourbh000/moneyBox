import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { BrokerModule } from './modules/broker/broker.module';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { StrategiesModule } from './modules/strategies/strategies.module';
import { BacktestModule } from './modules/backtest/backtest.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { RiskModule } from './modules/risk/risk.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { OptionBacktestModule } from './modules/option-backtest/option-backtest.module';
import { Orb15BacktestModule } from './modules/orb15-backtest/orb15-backtest.module';
import { LiveSignalModule } from './modules/live-signal/live-signal.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongoUri'),
      }),
    }),
    AuthModule,
    UsersModule,
    BrokerModule,
    MarketDataModule,
    StrategiesModule,
    BacktestModule,
    ExecutionModule,
    PortfolioModule,
    RiskModule,
    ReportsModule,
    AuditModule,
    OptionBacktestModule,
    Orb15BacktestModule,
    LiveSignalModule,
  ],
})
export class AppModule {}
