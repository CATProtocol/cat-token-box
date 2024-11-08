import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { CollectionService } from './collection.service';
import { okResponse, errorResponse } from '../../common/utils';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TokenService } from '../token/token.service';
import { Response } from 'express';
import { TokenTypeScope } from '../../common/types';

@Controller('collections')
export class CollectionController {
  constructor(
    private readonly collectionService: CollectionService,
    private readonly tokenService: TokenService,
  ) {}

  @Get(':collectionIdOrAddr')
  @ApiTags('collection')
  @ApiOperation({
    summary: 'Get collection info by collection id or collection address',
  })
  @ApiParam({
    name: 'collectionIdOrAddr',
    required: true,
    type: String,
    description: 'collection id or collection address',
  })
  async getCollectionInfo(
    @Param('collectionIdOrAddr') collectionIdOrAddr: string,
  ) {
    try {
      const collectionInfo =
        await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
          collectionIdOrAddr,
          TokenTypeScope.NonFungible,
        );
      if (collectionInfo) {
        Object.assign(collectionInfo, {
          collectionId: collectionInfo.tokenId,
          collectionAddr: collectionInfo.tokenAddr,
          collectionPubKey: collectionInfo.tokenPubKey,
          metadata: collectionInfo.info,
        });
        delete collectionInfo.tokenId;
        delete collectionInfo.tokenAddr;
        delete collectionInfo.tokenPubKey;
        delete collectionInfo.info;
        delete collectionInfo.decimals;
      }
      return okResponse(collectionInfo);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':collectionIdOrAddr/content')
  @ApiTags('collection')
  @ApiOperation({ summary: 'Get collection content' })
  @ApiParam({
    name: 'collectionIdOrAddr',
    required: true,
    type: String,
    description: 'collection id or collection address',
  })
  async getCollectionContent(
    @Param('collectionIdOrAddr') collectionIdOrAddr: string,
    @Res() res: Response,
  ) {
    try {
      const content =
        await this.collectionService.getCollectionContent(collectionIdOrAddr);
      if (content?.raw) {
        if (content?.type) {
          res.setHeader('Content-Type', content.type);
        }
        if (content?.encoding) {
          res.setHeader('Content-Encoding', content.encoding);
        }
        if (content?.lastModified) {
          res.setHeader('Last-Modified', content.lastModified.toUTCString());
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(content.raw);
      } else {
        res.sendStatus(404);
      }
    } catch (e) {
      return res.send(errorResponse(e));
    }
  }

  @Get(':collectionIdOrAddr/localId/:localId')
  @ApiTags('collection')
  @ApiOperation({ summary: 'Get nft info' })
  @ApiParam({
    name: 'collectionIdOrAddr',
    required: true,
    type: String,
    description: 'collection id or collection address',
  })
  @ApiParam({
    name: 'localId',
    required: true,
    type: Number,
    description: 'nft local id',
  })
  async getNftInfo(
    @Param('collectionIdOrAddr') collectionIdOrAddr: string,
    @Param('localId') localId: bigint,
  ) {
    try {
      const nftInfo = await this.collectionService.getNftInfo(
        collectionIdOrAddr,
        localId,
      );
      return okResponse(nftInfo);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':collectionIdOrAddr/localId/:localId/content')
  @ApiTags('collection')
  @ApiOperation({ summary: 'Get nft content' })
  @ApiParam({
    name: 'collectionIdOrAddr',
    required: true,
    type: String,
    description: 'collection id or collection address',
  })
  @ApiParam({
    name: 'localId',
    required: true,
    type: Number,
    description: 'nft local id',
  })
  async getNftContent(
    @Param('collectionIdOrAddr') collectionIdOrAddr: string,
    @Param('localId') localId: bigint,
    @Res() res: Response,
  ) {
    try {
      const content = await this.collectionService.getNftContent(
        collectionIdOrAddr,
        localId,
      );
      if (content?.raw) {
        if (content?.type) {
          res.setHeader('Content-Type', content.type);
        }
        if (content?.encoding) {
          res.setHeader('Content-Encoding', content.encoding);
        }
        if (content?.lastModified) {
          res.setHeader('Last-Modified', content.lastModified.toUTCString());
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(content.raw);
      } else {
        res.sendStatus(404);
      }
    } catch (e) {
      return res.send(errorResponse(e));
    }
  }

  @Get(':collectionIdOrAddr/localId/:localId/utxo')
  @ApiTags('collection')
  @ApiOperation({ summary: 'Get nft utxo' })
  @ApiParam({
    name: 'collectionIdOrAddr',
    required: true,
    type: String,
    description: 'collection id or collection address',
  })
  @ApiParam({
    name: 'localId',
    required: true,
    type: Number,
    description: 'nft local id',
  })
  async getNftUtxo(
    @Param('collectionIdOrAddr') collectionIdOrAddr: string,
    @Param('localId') localId: bigint,
  ) {
    try {
      const utxo = await this.collectionService.getNftUtxo(
        collectionIdOrAddr,
        localId,
      );
      return okResponse(utxo);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':collectionIdOrAddr/addresses/:ownerAddrOrPkh/utxos')
  @ApiTags('collection')
  @ApiOperation({ summary: 'Get collection utxos by owner address' })
  @ApiParam({
    name: 'collectionIdOrAddr',
    required: true,
    type: String,
    description: 'collection id or collection address',
  })
  @ApiParam({
    name: 'ownerAddrOrPkh',
    required: true,
    type: String,
    description: 'collection owner address or public key hash',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'paging offset',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'paging limit',
  })
  async getCollectionUtxosByOwnerAddress(
    @Param('collectionIdOrAddr') collectionIdOrAddr: string,
    @Param('ownerAddrOrPkh') ownerAddrOrPkh: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
  ) {
    try {
      const utxos = await this.tokenService.getTokenUtxosByOwnerAddress(
        collectionIdOrAddr,
        TokenTypeScope.NonFungible,
        ownerAddrOrPkh,
        offset,
        limit,
      );
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':collectionIdOrAddr/addresses/:ownerAddrOrPkh/utxoCount')
  @ApiTags('collection')
  @ApiOperation({ summary: 'Get collection utxo count by owner address' })
  @ApiParam({
    name: 'collectionIdOrAddr',
    required: true,
    type: String,
    description: 'collection id or collection address',
  })
  @ApiParam({
    name: 'ownerAddrOrPkh',
    required: true,
    type: String,
    description: 'collection owner address or public key hash',
  })
  async getCollectionBalanceByOwnerAddress(
    @Param('collectionIdOrAddr') collectionIdOrAddr: string,
    @Param('ownerAddrOrPkh') ownerAddrOrPkh: string,
  ) {
    try {
      const balance = await this.tokenService.getTokenBalanceByOwnerAddress(
        collectionIdOrAddr,
        TokenTypeScope.NonFungible,
        ownerAddrOrPkh,
      );
      return okResponse(
        balance && {
          collectionId: balance.tokenId,
          confirmed: balance.confirmed,
          trackerBlockHeight: balance.trackerBlockHeight,
        },
      );
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':collectionIdOrAddr/mintCount')
  @ApiTags('collection')
  @ApiOperation({
    summary: 'Get collection mint count by collection id or collection address',
  })
  @ApiParam({
    name: 'collectionIdOrAddr',
    required: true,
    type: String,
    description: 'collection id or collection address',
  })
  async getCollectionMintCount(
    @Param('collectionIdOrAddr') collectionIdOrAddr: string,
  ) {
    try {
      const mintCount = await this.tokenService.getTokenMintCount(
        collectionIdOrAddr,
        TokenTypeScope.NonFungible,
      );
      return okResponse(mintCount);
    } catch (e) {
      return errorResponse(e);
    }
  }
}
