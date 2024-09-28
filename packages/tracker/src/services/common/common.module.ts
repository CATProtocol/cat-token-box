import { Module } from '@nestjs/common';
import { CommonService } from './common.service';
import { RpcModule } from '../rpc/rpc.module';
import { BlockEntity } from '../../entities/block.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([BlockEntity]), RpcModule],
  providers: [CommonService],
  exports: [CommonService],
})
export class CommonModule {}
