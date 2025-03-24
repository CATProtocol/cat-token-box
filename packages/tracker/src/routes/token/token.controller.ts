import { Controller, Get, Param, Query } from '@nestjs/common';
import { TokenService } from './token.service';
import { okResponse, errorResponse } from '../../common/utils';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TokenTypeScope } from '../../common/types';

@Controller('tokens')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Get(':tokenIdOrTokenAddr')
  @ApiTags('token')
  @ApiOperation({ summary: 'Get token info by token id or token address' })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  async getTokenInfo(@Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string) {
    try {
      const tokenInfo = await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
        tokenIdOrTokenAddr,
        TokenTypeScope.Fungible,
      );
      return okResponse(tokenInfo);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/addresses/:ownerAddrOrPkh/utxos')
  @ApiTags('token')
  @ApiOperation({ summary: 'Get token utxos by owner address' })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  @ApiParam({
    name: 'ownerAddrOrPkh',
    required: true,
    type: String,
    description: 'token owner address or public key hash',
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
  async getTokenUtxosByOwnerAddress(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
    @Param('ownerAddrOrPkh') ownerAddrOrPkh: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
  ) {
    try {
      const utxos = await this.tokenService.getTokenUtxosByOwnerAddress(
        tokenIdOrTokenAddr,
        TokenTypeScope.Fungible,
        ownerAddrOrPkh,
        offset,
        limit,
      );
      return okResponse(utxos);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/addresses/:ownerAddrOrPkh/balance')
  @ApiTags('token')
  @ApiOperation({ summary: 'Get token balance by owner address' })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  @ApiParam({
    name: 'ownerAddrOrPkh',
    required: true,
    type: String,
    description: 'token owner address or public key hash',
  })
  async getTokenBalanceByOwnerAddress(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
    @Param('ownerAddrOrPkh') ownerAddrOrPkh: string,
  ) {
    try {
      const balance = await this.tokenService.getTokenBalanceByOwnerAddress(
        tokenIdOrTokenAddr,
        TokenTypeScope.Fungible,
        ownerAddrOrPkh,
      );
      return okResponse(balance);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/mintAmount')
  @ApiTags('token')
  @ApiOperation({
    summary: 'Get token total mint amount by token id or token address',
  })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  async getTokenMintAmount(@Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string) {
    try {
      const mintCount = await this.tokenService.getTokenMintAmount(tokenIdOrTokenAddr, TokenTypeScope.Fungible);
      return okResponse(mintCount);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/circulation')
  @ApiTags('token')
  @ApiOperation({
    summary: 'Get token current circulation by token id or token address',
  })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
  })
  async getTokenCirculation(@Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string) {
    try {
      const circulation = await this.tokenService.getTokenCirculation(tokenIdOrTokenAddr, TokenTypeScope.Fungible);
      return okResponse(circulation);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':tokenIdOrTokenAddr/holders')
  @ApiTags('token')
  @ApiOperation({
    summary: 'Get token holders by token id or token address',
  })
  @ApiParam({
    name: 'tokenIdOrTokenAddr',
    required: true,
    type: String,
    description: 'token id or token address',
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
  async getTokenHolders(
    @Param('tokenIdOrTokenAddr') tokenIdOrTokenAddr: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
  ) {
    try {
      const r = await this.tokenService.getTokenHolders(tokenIdOrTokenAddr, TokenTypeScope.Fungible, offset, limit);
      const holders = r.holders.map((holder) => {
        return {
          ownerPubKeyHash: holder.ownerPubKeyHash,
          balance: holder.tokenAmount!,
        };
      });
      return okResponse({
        holders,
        trackerBlockHeight: r.trackerBlockHeight,
      });
    } catch (e) {
      return errorResponse(e);
    }
  }
}
