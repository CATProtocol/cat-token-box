import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BlockService } from '../../services/block/block.service';
import { errorResponse, okResponse } from '../../common/utils';

@Controller()
export class HealthCheckController {
  constructor(private blockService: BlockService) {}

  @Get()
  @ApiTags('info')
  @ApiOperation({ summary: 'Check the health of the service' })
  async checkHealth() {
    try {
      const blockchainInfo = await this.blockService.getBlockchainInfo();
      return okResponse({
        trackerBlockHeight:
          await this.blockService.getLastProcessedBlockHeight(),
        nodeBlockHeight: blockchainInfo?.blocks || null,
        latestBlockHeight: blockchainInfo?.headers || null,
      });
    } catch (e) {
      return errorResponse(e);
    }
  }
}
