import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
// config
import { appConfig } from './config/app.config';
import { ormConfig } from './config/db.config';
// services
import { RpcModule } from './services/rpc/rpc.module';
import { BlockModule } from './services/block/block.module';
import { TxModule } from './services/tx/tx.module';
import { CommonModule } from './services/common/common.module';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig],
    }),
    TypeOrmModule.forRoot(ormConfig),

    RpcModule,
    BlockModule,
    TxModule,
    CommonModule,
  ],
  controllers: [],
  providers: [],
})
export class AppWorkerModule {}
