import { Module } from '@nestjs/common';
import { TxService } from './tx.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TxEntity } from '../../entities/tx.entity';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { CommonModule } from '../common/common.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TxOutEntity } from '../../entities/txOut.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TxEntity, TokenInfoEntity, TxOutEntity]),
    CommonModule,
    ScheduleModule.forRoot(),
  ],
  providers: [TxService],
  exports: [TxService],
})
export class TxModule {}
