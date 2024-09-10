import { Controller, Get, Param } from '@nestjs/common';
import { AddressService } from './address.service';
import { errorResponse, okResponse } from '../../common/utils';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

@Controller('addresses')
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get(':ownerAddr/balances')
  @ApiTags('address')
  @ApiOperation({ summary: 'Get token balances by owner address' })
  @ApiParam({
    name: 'ownerAddr',
    required: true,
    type: String,
    description: 'token owner address',
  })
  async getTokenBalances(@Param('ownerAddr') ownerAddr: string) {
    try {
      const balances = await this.addressService.getTokenBalances(ownerAddr);
      return okResponse(balances);
    } catch (e) {
      return errorResponse(e);
    }
  }
}
