import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { TokenController } from './token.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { TxOutEntity } from '../../entities/txOut.entity';
import { TxEntity } from '../../entities/tx.entity';
import { CommonModule } from '../../services/common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenInfoEntity, TxOutEntity, TxEntity]),
    CommonModule,
  ],
  providers: [TokenService],
  controllers: [TokenController],
  exports: [TokenService],
})
export class TokenModule {}
