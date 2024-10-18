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
      const tokenInfo =
        await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
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
}
