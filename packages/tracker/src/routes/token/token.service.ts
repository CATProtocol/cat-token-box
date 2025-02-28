import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import {
  IsNull,
  LessThanOrEqual,
  Repository,
  MoreThanOrEqual,
  LessThan,
} from 'typeorm';
import {
  addressToXOnlyPubKey,
  ownerAddressToPubKeyHash,
  xOnlyPubKeyToAddress,
} from '../../common/utils';
import { TxOutEntity } from '../../entities/txOut.entity';
import { Constants } from '../../common/constants';
import { LRUCache } from 'lru-cache';
import { TxEntity } from '../../entities/tx.entity';
import { CommonService } from '../../services/common/common.service';
import { TokenTypeScope } from '../../common/types';
import { TokenMintEntity } from '../../entities/tokenMint.entity';

@Injectable()
export class TokenService {
  private static readonly stateHashesCache = new LRUCache<string, string[]>({
    max: Constants.CACHE_MAX_SIZE,
  });

  private static readonly tokenInfoCache = new LRUCache<
    string,
    TokenInfoEntity
  >({
    max: Constants.CACHE_MAX_SIZE,
  });

  constructor(
    private readonly commonService: CommonService,
    @InjectRepository(TokenInfoEntity)
    private readonly tokenInfoRepository: Repository<TokenInfoEntity>,
    @InjectRepository(TxOutEntity)
    private readonly txOutRepository: Repository<TxOutEntity>,
    @InjectRepository(TxEntity)
    private readonly txRepository: Repository<TxEntity>,
    @InjectRepository(TokenMintEntity)
    private readonly tokenMintRepository: Repository<TokenMintEntity>,
  ) {}

  async getTokenInfoByTokenIdOrTokenAddress(
    tokenIdOrTokenAddr: string,
    scope: TokenTypeScope,
  ) {
    let cached = TokenService.tokenInfoCache.get(tokenIdOrTokenAddr);
    if (!cached) {
      let where: object;
      if (tokenIdOrTokenAddr.includes('_')) {
        where = { tokenId: tokenIdOrTokenAddr };
      } else {
        const tokenPubKey = addressToXOnlyPubKey(tokenIdOrTokenAddr);
        if (!tokenPubKey) {
          return null;
        }
        where = { tokenPubKey };
      }
      if (scope === TokenTypeScope.Fungible) {
        where = Object.assign(where, { decimals: MoreThanOrEqual(0) });
      } else if (scope === TokenTypeScope.NonFungible) {
        where = Object.assign(where, { decimals: LessThan(0) });
      }
      const tokenInfo = await this.tokenInfoRepository.findOne({
        select: [
          'tokenId',
          'revealTxid',
          'revealHeight',
          'genesisTxid',
          'name',
          'symbol',
          'decimals',
          'rawInfo',
          'minterPubKey',
          'tokenPubKey',
          'firstMintHeight',
        ],
        where,
      });
      if (tokenInfo && tokenInfo.tokenPubKey) {
        const lastProcessedHeight =
          await this.commonService.getLastProcessedBlockHeight();
        if (
          lastProcessedHeight !== null &&
          lastProcessedHeight - tokenInfo.revealHeight >=
            Constants.CACHE_AFTER_N_BLOCKS
        ) {
          TokenService.tokenInfoCache.set(tokenIdOrTokenAddr, tokenInfo);
        }
      }
      cached = tokenInfo;
    } else {
      if (cached.decimals < 0 && scope === TokenTypeScope.Fungible) {
        cached = null;
      } else if (cached.decimals >= 0 && scope === TokenTypeScope.NonFungible) {
        cached = null;
      }
    }
    return this.renderTokenInfo(cached);
  }

  async getTokenInfoByTokenPubKey(tokenPubKey: string, scope: TokenTypeScope) {
    const tokenAddr = xOnlyPubKeyToAddress(tokenPubKey);
    return this.getTokenInfoByTokenIdOrTokenAddress(tokenAddr, scope);
  }

  renderTokenInfo(tokenInfo: TokenInfoEntity) {
    if (!tokenInfo) {
      return null;
    }
    const minterAddr = xOnlyPubKeyToAddress(tokenInfo.minterPubKey);
    const tokenAddr = xOnlyPubKeyToAddress(tokenInfo.tokenPubKey);
    const rendered = Object.assign(
      {},
      { minterAddr, tokenAddr, info: tokenInfo.rawInfo },
      tokenInfo,
    );
    delete rendered.rawInfo;
    return rendered;
  }

  async getTokenUtxosByOwnerAddress(
    tokenIdOrTokenAddr: string,
    scope: TokenTypeScope,
    ownerAddrOrPkh: string,
    offset?: number,
    limit?: number,
  ) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const tokenInfo = await this.getTokenInfoByTokenIdOrTokenAddress(
      tokenIdOrTokenAddr,
      scope,
    );
    let utxos = [];
    if (tokenInfo) {
      utxos = await this.queryTokenUtxosByOwnerAddress(
        lastProcessedHeight,
        ownerAddrOrPkh,
        tokenInfo,
        offset || Constants.QUERY_PAGING_DEFAULT_OFFSET,
        Math.min(
          limit || Constants.QUERY_PAGING_DEFAULT_LIMIT,
          Constants.QUERY_PAGING_MAX_LIMIT,
        ),
      );
    }
    return {
      utxos: await this.renderUtxos(utxos, tokenInfo),
      trackerBlockHeight: lastProcessedHeight,
    };
  }

  async getTokenBalanceByOwnerAddress(
    tokenIdOrTokenAddr: string,
    scope: TokenTypeScope.Fungible | TokenTypeScope.NonFungible,
    ownerAddrOrPkh: string,
  ) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const tokenInfo = await this.getTokenInfoByTokenIdOrTokenAddress(
      tokenIdOrTokenAddr,
      scope,
    );
    if (!tokenInfo) {
      return null;
    }
    const balances = await this.queryTokenBalancesByOwnerAddress(
      lastProcessedHeight,
      ownerAddrOrPkh,
      scope,
      tokenInfo,
    );
    return {
      tokenId: tokenInfo.tokenId,
      confirmed: balances.length === 1 ? balances[0].confirmed.toString() : '0',
      trackerBlockHeight: lastProcessedHeight,
    };
  }

  async queryTokenUtxosByOwnerAddress(
    lastProcessedHeight: number,
    ownerAddrOrPkh: string,
    tokenInfo: TokenInfoEntity | null = null,
    offset: number | null = null,
    limit: number | null = null,
  ) {
    const ownerPubKeyHash = ownerAddressToPubKeyHash(ownerAddrOrPkh);
    if (
      lastProcessedHeight === null ||
      (tokenInfo && !tokenInfo.tokenPubKey) ||
      !ownerPubKeyHash
    ) {
      return [];
    }
    const where = {
      ownerPubKeyHash,
      spendTxid: IsNull(),
      blockHeight: LessThanOrEqual(lastProcessedHeight),
    };
    if (tokenInfo) {
      Object.assign(where, { xOnlyPubKey: tokenInfo.tokenPubKey });
    }
    return this.txOutRepository.find({
      where,
      order: { tokenAmount: 'DESC' },
      skip: offset,
      take: limit,
    });
  }

  async queryTokenBalancesByOwnerAddress(
    lastProcessedHeight: number,
    ownerAddrOrPkh: string,
    scope: TokenTypeScope.Fungible | TokenTypeScope.NonFungible,
    tokenInfo: TokenInfoEntity | null = null,
  ) {
    const ownerPubKeyHash = ownerAddressToPubKeyHash(ownerAddrOrPkh);
    if (
      lastProcessedHeight === null ||
      (tokenInfo && !tokenInfo.tokenPubKey) ||
      !ownerPubKeyHash
    ) {
      return [];
    }
    const query = this.txOutRepository
      .createQueryBuilder('t1')
      .select('t2.token_id', 'tokenId')
      .innerJoin(TokenInfoEntity, 't2', 't1.xonly_pubkey = t2.token_pubkey')
      .where('t1.spend_txid IS NULL')
      .andWhere('t1.owner_pkh = :ownerPkh', { ownerPkh: ownerPubKeyHash })
      .groupBy('t2.token_id');
    if (scope === TokenTypeScope.Fungible) {
      query
        .addSelect('SUM(t1.token_amount)', 'confirmed')
        .andWhere('t2.decimals >= 0');
    } else {
      query.addSelect('COUNT(1)', 'confirmed').andWhere('t2.decimals < 0');
    }
    if (tokenInfo) {
      query.andWhere('t1.xonly_pubkey = :tokenPubKey', {
        tokenPubKey: tokenInfo.tokenPubKey,
      });
    }
    const results = await query.getRawMany();
    return results.map((r) => ({
      tokenId: r.tokenId,
      confirmed: r.confirmed,
    }));
  }

  async queryStateHashes(txid: string) {
    let cached = TokenService.stateHashesCache.get(txid);
    if (!cached) {
      const tx = await this.txRepository.findOne({
        select: ['stateHashes'],
        where: { txid },
      });
      cached = tx.stateHashes.split(';').slice(1);
      if (cached.length < Constants.CONTRACT_OUTPUT_MAX_COUNT) {
        cached = cached.concat(
          Array(Constants.CONTRACT_OUTPUT_MAX_COUNT - cached.length).fill(''),
        );
      }
      TokenService.stateHashesCache.set(txid, cached);
    }
    return cached;
  }

  /**
   * render token utxos when passing tokenInfo, otherwise render minter utxos
   */
  async renderUtxos(utxos: TxOutEntity[], tokenInfo?: TokenInfoEntity) {
    const renderedUtxos = [];
    for (const utxo of utxos) {
      const txoStateHashes = await this.queryStateHashes(utxo.txid);
      const renderedUtxo = {
        utxo: {
          txId: utxo.txid,
          outputIndex: utxo.outputIndex,
          script: utxo.lockingScript,
          satoshis: utxo.satoshis,
        },
        txoStateHashes,
      };
      if (utxo.ownerPubKeyHash !== null && utxo.tokenAmount !== null) {
        Object.assign(
          renderedUtxo,
          tokenInfo && tokenInfo.decimals >= 0
            ? {
                state: {
                  address: utxo.ownerPubKeyHash,
                  amount: utxo.tokenAmount,
                },
              }
            : {
                state: {
                  address: utxo.ownerPubKeyHash,
                  localId: utxo.tokenAmount,
                },
              },
        );
      }
      renderedUtxos.push(renderedUtxo);
    }
    return renderedUtxos;
  }

  async getTokenMintAmount(
    tokenIdOrTokenAddr: string,
    scope: TokenTypeScope.Fungible | TokenTypeScope.NonFungible,
  ): Promise<{
    amount: string;
    trackerBlockHeight: number;
  }> {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const tokenInfo = await this.getTokenInfoByTokenIdOrTokenAddress(
      tokenIdOrTokenAddr,
      scope,
    );
    let amount = '0';
    if (tokenInfo && tokenInfo.tokenPubKey && lastProcessedHeight) {
      const where = {
        tokenPubKey: tokenInfo.tokenPubKey,
        blockHeight: LessThanOrEqual(lastProcessedHeight),
      };
      if (scope === TokenTypeScope.Fungible) {
        const r = await this.tokenMintRepository
          .createQueryBuilder()
          .select('SUM(token_amount)', 'count')
          .where(where)
          .getRawOne();
        amount = r?.count || '0';
      } else {
        const r = await this.tokenMintRepository.count({ where });
        amount = (r || 0).toString();
      }
    }
    return {
      amount,
      trackerBlockHeight: lastProcessedHeight,
    };
  }

  async getTokenCirculation(
    tokenIdOrTokenAddr: string,
    scope: TokenTypeScope.Fungible | TokenTypeScope.NonFungible,
  ): Promise<{
    amount: string;
    trackerBlockHeight: number;
  }> {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const tokenInfo = await this.getTokenInfoByTokenIdOrTokenAddress(
      tokenIdOrTokenAddr,
      scope,
    );
    let amount = '0';
    if (tokenInfo && tokenInfo.tokenPubKey && lastProcessedHeight) {
      const where = {
        xOnlyPubKey: tokenInfo.tokenPubKey,
        spendTxid: IsNull(),
      };
      if (scope === TokenTypeScope.Fungible) {
        const r = await this.txOutRepository
          .createQueryBuilder()
          .select('SUM(token_amount)', 'count')
          .where(where)
          .getRawOne();
        amount = r?.count || '0';
      } else {
        const r = await this.txOutRepository.count({ where });
        amount = (r || 0).toString();
      }
    }
    return {
      amount,
      trackerBlockHeight: lastProcessedHeight,
    };
  }

  async getTokenHolders(
    tokenIdOrTokenAddr: string,
    scope: TokenTypeScope.Fungible | TokenTypeScope.NonFungible,
    offset: number | null = null,
    limit: number | null = null,
  ): Promise<{
    holders: {
      ownerPubKeyHash: string;
      tokenAmount?: string;
      nftAmount?: number;
    }[];
    trackerBlockHeight: number;
  }> {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const tokenInfo = await this.getTokenInfoByTokenIdOrTokenAddress(
      tokenIdOrTokenAddr,
      scope,
    );
    let holders = [];
    if (tokenInfo && tokenInfo.tokenPubKey && lastProcessedHeight) {
      const query = this.txOutRepository
        .createQueryBuilder()
        .select('owner_pkh', 'ownerPubKeyHash')
        .where('spend_txid IS NULL')
        .andWhere('xonly_pubkey = :xonlyPubkey', {
          xonlyPubkey: tokenInfo.tokenPubKey,
        })
        .groupBy('owner_pkh')
        .limit(
          Math.min(
            limit || Constants.QUERY_PAGING_DEFAULT_LIMIT,
            Constants.QUERY_PAGING_MAX_LIMIT,
          ),
        )
        .offset(offset || Constants.QUERY_PAGING_DEFAULT_OFFSET);
      if (scope === TokenTypeScope.Fungible) {
        query
          .addSelect('SUM(token_amount)', 'tokenAmount')
          .orderBy('SUM(token_amount)', 'DESC');
      } else {
        query.addSelect('COUNT(1)', 'nftAmount').orderBy('COUNT(1)', 'DESC');
      }
      holders = await query.getRawMany();
    }
    return {
      holders,
      trackerBlockHeight: lastProcessedHeight,
    };
  }
}
