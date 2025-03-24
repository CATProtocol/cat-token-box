import { Controller, Get, Param } from '@nestjs/common';
import { AddressService } from './address.service';
import { errorResponse, okResponse } from '../../common/utils';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

@Controller('addresses')
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get(':ownerAddrOrPkh/balances')
  @ApiTags('address')
  @ApiOperation({ summary: 'Get token balances by owner address' })
  @ApiParam({
    name: 'ownerAddrOrPkh',
    required: true,
    type: String,
    description: 'token owner address or public key hash',
  })
  async getTokenBalances(@Param('ownerAddrOrPkh') ownerAddrOrPkh: string) {
    try {
      const balances = await this.addressService.getTokenBalances(ownerAddrOrPkh);
      return okResponse(balances);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':ownerAddrOrPkh/collections')
  @ApiTags('address')
  @ApiOperation({ summary: 'Get collection balances by owner address' })
  @ApiParam({
    name: 'ownerAddrOrPkh',
    required: true,
    type: String,
    description: 'collection owner address or public key hash',
  })
  async getCollectionBalances(@Param('ownerAddrOrPkh') ownerAddrOrPkh: string) {
    try {
      const balances = await this.addressService.getCollectionBalances(ownerAddrOrPkh);
      return okResponse({
        collections: balances.balances.map((balance) => {
          return {
            collectionId: balance.tokenId,
            confirmed: balance.confirmed,
          };
        }),
        trackerBlockHeight: balances.trackerBlockHeight,
      });
    } catch (e) {
      return errorResponse(e);
    }
  }
}
