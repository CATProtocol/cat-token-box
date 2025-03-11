import { Module } from '@nestjs/common';
import { TxService } from './tx.service';
import { TxController } from './tx.controller';
import { TokenModule } from '../token/token.module';
import { CommonModule } from '../../services/common/common.module';
import { TxOutEntity } from '../../entities/txOut.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([TxOutEntity]), TokenModule, CommonModule],
  providers: [TxService],
  controllers: [TxController],
})
export class TxModule {}
