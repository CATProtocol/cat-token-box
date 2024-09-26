import { Module } from '@nestjs/common';
import { MinterService } from './minter.service';
import { MinterController } from './minter.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TxOutEntity } from '../../entities/txOut.entity';
import { TokenModule } from '../token/token.module';
import { CommonModule } from '../../services/common/common.module';

@Module({
  imports: [TokenModule, CommonModule, TypeOrmModule.forFeature([TxOutEntity])],
  providers: [MinterService],
  controllers: [MinterController],
})
export class MinterModule {}
