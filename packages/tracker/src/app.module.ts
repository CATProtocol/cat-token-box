import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// config
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
// routes
import { HealthCheckModule } from './routes/healthCheck/healthCheck.module';
import { TokenModule } from './routes/token/token.module';
import { MinterModule } from './routes/minter/minter.module';
import { AddressModule } from './routes/address/address.module';
// services
import { RpcModule } from './services/rpc/rpc.module';
import { BlockModule } from './services/block/block.module';
import { TxModule } from './services/tx/tx.module';
// entities
import { BlockEntity } from './entities/block.entity';
import { TxEntity } from './entities/tx.entity';
import { TxOutEntity } from './entities/txOut.entity';
import { TokenInfoEntity } from './entities/tokenInfo.entity';
import { TokenMintEntity } from './entities/tokenMint.entity';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
    }),

    HealthCheckModule,
    TokenModule,
    MinterModule,
    AddressModule,

    RpcModule,
    BlockModule,
    TxModule,

    TypeOrmModule.forRoot({
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      type: process.env.DATABASE_TYPE,
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT),
      username: process.env.DATABASE_USERNAME,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_DB,
      entities: [
        BlockEntity,
        TxEntity,
        TxOutEntity,
        TokenInfoEntity,
        TokenMintEntity,
      ],
      synchronize: true,
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
