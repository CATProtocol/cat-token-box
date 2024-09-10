import { Module } from '@nestjs/common';
import { BlockService } from './block.service';
import { RpcModule } from '../rpc/rpc.module';
import { BlockEntity } from '../../entities/block.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { TxModule } from '../tx/tx.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BlockEntity]),
    RpcModule,
    TxModule,
    ConfigModule,
  ],
  providers: [BlockService],
  exports: [BlockService],
})
export class BlockModule {}
