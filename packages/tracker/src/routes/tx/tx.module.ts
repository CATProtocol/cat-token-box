import { Module } from '@nestjs/common';
import { TxService } from './tx.service';
import { TxController } from './tx.controller';
import { TokenModule } from '../token/token.module';
import { CommonModule } from '../../services/common/common.module';

@Module({
  imports: [TokenModule, CommonModule],
  providers: [TxService],
  controllers: [TxController],
  exports: [TxService],
})
export class TxModule {}
