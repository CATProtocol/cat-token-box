import { Injectable } from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { InjectRepository } from '@nestjs/typeorm';
import { TxOutEntity } from '../../entities/txOut.entity';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Constants } from '../../common/constants';
import { BlockService } from '../../services/block/block.service';

@Injectable()
export class MinterService {
  constructor(
    private readonly blockService: BlockService,
    private readonly tokenService: TokenService,
    @InjectRepository(TxOutEntity)
    private readonly txOutRepository: Repository<TxOutEntity>,
  ) {}

  async getMinterUtxos(
    tokenIdOrTokenAddr: string,
    offset: number,
    limit: number,
  ) {
    const utxos = await this.queryMinterUtxos(
      tokenIdOrTokenAddr,
      offset || Constants.QUERY_PAGING_DEFAULT_OFFSET,
      Math.min(
        limit || Constants.QUERY_PAGING_DEFAULT_LIMIT,
        Constants.QUERY_PAGING_MAX_LIMIT,
      ),
    );
    return {
      utxos: await this.tokenService.renderUtxos(utxos.utxos),
      trackerBlockHeight: utxos.trackerBlockHeight,
    };
  }

  async getMinterUtxoCount(tokenIdOrTokenAddr: string) {
    const utxos = await this.queryMinterUtxos(tokenIdOrTokenAddr);
    return {
      count: utxos.utxos.length,
      trackerBlockHeight: utxos.trackerBlockHeight,
    };
  }

  async queryMinterUtxos(
    tokenIdOrTokenAddr: string,
    offset: number = null,
    limit: number = null,
  ) {
    const lastProcessedHeight =
      await this.blockService.getLastProcessedBlockHeight();
    const tokenInfo =
      await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
        tokenIdOrTokenAddr,
      );
    let utxos = [];
    if (lastProcessedHeight !== null && tokenInfo?.minterPubKey) {
      utxos = await this.txOutRepository.find({
        where: {
          xOnlyPubKey: tokenInfo.minterPubKey,
          spendTxid: IsNull(),
          blockHeight: LessThanOrEqual(lastProcessedHeight),
        },
        order: { createdAt: 'ASC' },
        skip: offset,
        take: limit,
      });
    }
    return { utxos, trackerBlockHeight: lastProcessedHeight };
  }
}
