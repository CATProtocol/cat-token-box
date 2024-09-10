import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { TokenController } from './token.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { TxOutEntity } from '../../entities/txOut.entity';
import { BlockModule } from '../../services/block/block.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TokenInfoEntity, TxOutEntity]),
    BlockModule,
  ],
  providers: [TokenService],
  controllers: [TokenController],
  exports: [TokenService],
})
export class TokenModule {}
