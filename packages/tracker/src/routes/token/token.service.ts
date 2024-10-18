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
    scope: TokenTypeScope,
    ownerAddrOrPkh: string,
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
      );
    }
    let confirmed = '0';
    if (tokenInfo?.tokenPubKey) {
      const tokenBalances = await this.groupTokenBalances(utxos);
      confirmed = tokenBalances[tokenInfo.tokenPubKey]?.toString() || '0';
    }
    return {
      tokenId: tokenInfo?.tokenId || null,
      confirmed,
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
    const ownerPubKeyHash =
      ownerAddrOrPkh.length === Constants.PUBKEY_HASH_BYTES * 2
        ? ownerAddrOrPkh
        : ownerAddressToPubKeyHash(ownerAddrOrPkh);
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

  /**
   * @param utxos utxos with the same owner address
   * @returns token balances grouped by xOnlyPubKey
   */
  async groupTokenBalances(utxos: TxOutEntity[]) {
    const balances = {};
    for (const utxo of utxos) {
      const tokenInfo = await this.getTokenInfoByTokenPubKey(
        utxo.xOnlyPubKey,
        TokenTypeScope.All,
      );
      if (tokenInfo) {
        const acc = tokenInfo.decimals >= 0 ? BigInt(utxo.tokenAmount) : 1n;
        balances[utxo.xOnlyPubKey] = (balances[utxo.xOnlyPubKey] || 0n) + acc;
      }
    }
    return balances;
  }
}
