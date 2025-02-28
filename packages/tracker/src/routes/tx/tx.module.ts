import { Module } from '@nestjs/common';
import { TxService } from './tx.service';
import { TxController } from './tx.controller';
import { TokenModule } from '../token/token.module';
import { CommonModule } from '../../services/common/common.module';
import { RpcModule } from '../../services/rpc/rpc.module';

@Module({
  imports: [TokenModule, CommonModule, RpcModule],
  providers: [TxService],
  controllers: [TxController],
  exports: [TxService],
})
export class TxModule {}
