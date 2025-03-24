import { Controller, Get, Param, Res } from '@nestjs/common';
import { TxService } from './tx.service';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { errorResponse, okResponse } from '../../common/utils';
import { Response } from 'express';

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
  async parseTransferTxTokenOutputs(@Param('txid') txid: string) {
    try {
      const parsedTx = await this.txService.parseTransferTxTokenOutputs(txid);
      return okResponse(parsedTx);
    } catch (e) {
      return errorResponse(e);
    }
  }

  @Get(':txid/content/:inputIndex')
  @ApiTags('tx')
  @ApiOperation({ summary: 'Get content from a specific tx input' })
  @ApiParam({
    name: 'txid',
    required: true,
    type: String,
    description: 'txid',
  })
  @ApiParam({
    name: 'inputIndex',
    required: true,
    type: 'integer',
    description: 'input index',
  })
  async parseDelegateContent(
    @Param('txid') txid: string,
    @Param('inputIndex') inputIndex: number,
    @Res() res: Response,
  ) {
    try {
      const inputIndexBuf = Buffer.alloc(4);
      inputIndexBuf.writeUInt32LE(inputIndex || 0);
      const delegate = Buffer.concat([Buffer.from(txid, 'hex').reverse(), inputIndexBuf]);
      const content = await this.txService.getDelegateContent(delegate);
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
}
