import { Module } from '@nestjs/common';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../services/common/common.module';
import { TokenModule } from '../token/token.module';
import { TxOutEntity } from '../../entities/txOut.entity';
import { NftInfoEntity } from '../../entities/nftInfo.entity';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TxOutEntity, NftInfoEntity, TokenInfoEntity]),
    CommonModule,
    TokenModule,
  ],
  providers: [CollectionService],
  controllers: [CollectionController],
  exports: [CollectionService],
})
export class CollectionModule {}
