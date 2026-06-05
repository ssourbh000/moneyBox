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
import { ExecutionModule } from './modules/execution/execution.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { RiskModule } from './modules/risk/risk.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { OrbSimulatorModule } from './modules/orb-simulator/orb-simulator.module';
import { LiveSignalModule } from './modules/live-signal/live-signal.module';
import { IVCrushModule } from './modules/iv-crush/iv-crush.module';
import { EventAlphaPaperModule } from './modules/event-alpha-paper/event-alpha-paper.module';
import { IVCrushSimulatorModule } from './modules/iv-crush-simulator/iv-crush-simulator.module';
import { EventAlphaSimulatorModule } from './modules/event-alpha-simulator/event-alpha-simulator.module';
import { UnifiedSimulatorModule } from './modules/unified-simulator/unified-simulator.module';

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
    ExecutionModule,
    PortfolioModule,
    RiskModule,
    ReportsModule,
    AuditModule,
    OrbSimulatorModule,
    LiveSignalModule,
    IVCrushModule,
    EventAlphaPaperModule,
    IVCrushSimulatorModule,
    EventAlphaSimulatorModule,
    UnifiedSimulatorModule,
  ],
})
export class AppModule {}
