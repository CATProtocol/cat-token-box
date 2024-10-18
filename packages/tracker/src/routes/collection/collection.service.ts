import { Injectable } from '@nestjs/common';
import { CommonService } from '../../services/common/common.service';
import { TokenService } from '../token/token.service';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { TxOutEntity } from '../../entities/txOut.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { LRUCache } from 'lru-cache';
import { NftInfoEntity } from '../../entities/nftInfo.entity';
import { Constants } from '../../common/constants';
import { Content, TokenTypeScope } from '../../common/types';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';

@Injectable()
export class CollectionService {
  private static readonly nftInfoCache = new LRUCache<string, NftInfoEntity>({
    max: Constants.CACHE_MAX_SIZE,
  });

  private static readonly nftContentCache = new LRUCache<string, Content>({
    max: Constants.CACHE_MAX_SIZE,
  });

  constructor(
    private readonly commonService: CommonService,
    private readonly tokenService: TokenService,
    @InjectRepository(TxOutEntity)
    private readonly txOutRepository: Repository<TxOutEntity>,
    @InjectRepository(NftInfoEntity)
    private readonly nftInfoRepository: Repository<NftInfoEntity>,
    @InjectRepository(TokenInfoEntity)
    private readonly tokenInfoRepository: Repository<TokenInfoEntity>,
  ) {}

  async getCollectionContent(
    collectionIdOrAddr: string,
  ): Promise<Content | null> {
    const key = `${collectionIdOrAddr}`;
    let cached = CollectionService.nftContentCache.get(key);
    if (!cached) {
      const collectionInfo =
        await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
          collectionIdOrAddr,
          TokenTypeScope.NonFungible,
        );
      if (collectionInfo) {
        const collectionContent = await this.tokenInfoRepository.findOne({
          select: [
            'revealHeight',
            'contentType',
            'contentEncoding',
            'contentRaw',
          ],
          where: { tokenId: collectionInfo.tokenId },
        });
        if (collectionContent) {
          cached = {
            type: collectionContent.contentType,
            encoding: collectionContent.contentEncoding,
            raw: collectionContent.contentRaw,
          };
          const lastProcessedHeight =
            await this.commonService.getLastProcessedBlockHeight();
          if (
            lastProcessedHeight !== null &&
            lastProcessedHeight - collectionContent.revealHeight >=
              Constants.CACHE_AFTER_N_BLOCKS
          ) {
            CollectionService.nftContentCache.set(key, cached);
          }
        }
      }
    }
    return cached;
  }

  async getNftInfo(collectionIdOrAddr: string, localId: bigint) {
    const key = `${collectionIdOrAddr}_${localId}`;
    let cached = CollectionService.nftInfoCache.get(key);
    if (!cached) {
      const collectionInfo =
        await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
          collectionIdOrAddr,
          TokenTypeScope.NonFungible,
        );
      if (collectionInfo) {
        const nftInfo = await this.nftInfoRepository.findOne({
          select: [
            'collectionId',
            'localId',
            'mintTxid',
            'mintHeight',
            'commitTxid',
            'metadata',
          ],
          where: { collectionId: collectionInfo.tokenId, localId },
        });
        if (nftInfo) {
          const lastProcessedHeight =
            await this.commonService.getLastProcessedBlockHeight();
          if (
            lastProcessedHeight !== null &&
            lastProcessedHeight - nftInfo.mintHeight >=
              Constants.CACHE_AFTER_N_BLOCKS
          ) {
            CollectionService.nftInfoCache.set(key, nftInfo);
          }
        }
        cached = nftInfo;
      }
    }
    return cached;
  }

  async getNftContent(
    collectionIdOrAddr: string,
    localId: bigint,
  ): Promise<Content | null> {
    const key = `${collectionIdOrAddr}_${localId}`;
    let cached = CollectionService.nftContentCache.get(key);
    if (!cached) {
      const collectionInfo =
        await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
          collectionIdOrAddr,
          TokenTypeScope.NonFungible,
        );
      if (collectionInfo) {
        const nftContent = await this.nftInfoRepository.findOne({
          select: [
            'mintHeight',
            'contentType',
            'contentEncoding',
            'contentRaw',
          ],
          where: { collectionId: collectionInfo.tokenId, localId },
        });
        if (nftContent) {
          cached = {
            type: nftContent.contentType,
            encoding: nftContent.contentEncoding,
            raw: nftContent.contentRaw,
          };
          const lastProcessedHeight =
            await this.commonService.getLastProcessedBlockHeight();
          if (
            lastProcessedHeight !== null &&
            lastProcessedHeight - nftContent.mintHeight >=
              Constants.CACHE_AFTER_N_BLOCKS
          ) {
            CollectionService.nftContentCache.set(key, cached);
          }
        }
      }
    }
    return cached;
  }

  async getNftUtxo(collectionIdOrAddr: string, localId: bigint) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const collectionInfo =
      await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
        collectionIdOrAddr,
        TokenTypeScope.NonFungible,
      );
    let utxos = [];
    if (collectionInfo && collectionInfo.tokenPubKey) {
      const where = {
        xOnlyPubKey: collectionInfo.tokenPubKey,
        tokenAmount: localId,
        spendTxid: IsNull(),
        blockHeight: LessThanOrEqual(lastProcessedHeight),
      };
      utxos = await this.txOutRepository.find({
        where,
        take: 1,
      });
    }
    const renderedUtxos = await this.tokenService.renderUtxos(
      utxos,
      collectionInfo,
    );
    const utxo = renderedUtxos.length > 0 ? renderedUtxos[0] : null;
    return {
      utxo,
      trackerBlockHeight: lastProcessedHeight,
    };
  }
}
