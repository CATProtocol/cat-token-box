import { Injectable } from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { InjectRepository } from '@nestjs/typeorm';
import { TxOutEntity } from '../../entities/txOut.entity';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Constants } from '../../common/constants';
import { CommonService } from '../../services/common/common.service';

@Injectable()
export class MinterService {
  constructor(
    private readonly commonService: CommonService,
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
      false,
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
    return this.queryMinterUtxos(tokenIdOrTokenAddr, true);
  }

  async queryMinterUtxos(
    tokenIdOrTokenAddr: string,
    isCountQuery: boolean = false,
    offset: number = null,
    limit: number = null,
  ) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const tokenInfo =
      await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
        tokenIdOrTokenAddr,
      );
    let count = 0;
    let utxos = [];
    if (lastProcessedHeight !== null && tokenInfo?.minterPubKey) {
      const where = {
        xOnlyPubKey: tokenInfo.minterPubKey,
        spendTxid: IsNull(),
        blockHeight: LessThanOrEqual(lastProcessedHeight),
      };
      if (isCountQuery) {
        count = await this.txOutRepository.count({
          where,
        });
      } else {
        utxos = await this.txOutRepository.find({
          where,
          order: { createdAt: 'ASC' },
          skip: offset,
          take: limit,
        });
      }
    }
    return Object.assign({}, isCountQuery ? { count } : { utxos }, {
      trackerBlockHeight: lastProcessedHeight,
    });
  }
}
