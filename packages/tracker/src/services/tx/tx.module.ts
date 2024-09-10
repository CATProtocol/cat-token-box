import { Module } from '@nestjs/common';
import { TxService } from './tx.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TxEntity } from '../../entities/tx.entity';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TxEntity, TokenInfoEntity])],
  providers: [TxService],
  exports: [TxService],
})
export class TxModule {}
