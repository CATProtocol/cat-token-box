import { Module } from '@nestjs/common';
import { RpcService } from './rpc.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [RpcService],
  exports: [RpcService],
})
export class RpcModule {}
