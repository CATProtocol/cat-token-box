import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
// config
import { appConfig } from './config/app.config';
import { ormConfig } from './config/db.config';
// routes
import { HealthCheckModule } from './routes/healthCheck/healthCheck.module';
import { TokenModule } from './routes/token/token.module';
import { MinterModule } from './routes/minter/minter.module';
import { AddressModule } from './routes/address/address.module';
// serivces
import { CommonModule } from './services/common/common.module';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig],
    }),
    TypeOrmModule.forRoot(ormConfig),

    HealthCheckModule,
    TokenModule,
    MinterModule,
    AddressModule,

    CommonModule,
  ],
  controllers: [],
  providers: [],
})
export class AppApiModule {}
