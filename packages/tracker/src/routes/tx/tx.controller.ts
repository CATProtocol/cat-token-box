import { Controller, Get, Param } from '@nestjs/common';
import { TxService } from './tx.service';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { errorResponse, okResponse } from '../../common/utils';

@Controller('tx')
export class TxController {
  constructor(private readonly txService: TxService) {}

  @Get(':txid')
  @ApiTags('tx')
  @ApiOperation({ summary: 'Get tx token outputs by txid' })
  @ApiParam({
    name: 'txid',
    required: true,
    type: String,
    description: 'txid',
  })
  async getTx(@Param('txid') txid: string) {
    try {
      const parsedTx = await this.txService.getTx(txid);
      return okResponse(parsedTx);
    } catch (e) {
      return errorResponse(e);
    }
  }
}
