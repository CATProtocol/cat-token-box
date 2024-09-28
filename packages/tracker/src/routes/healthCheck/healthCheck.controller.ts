import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { errorResponse, okResponse } from '../../common/utils';
import { CommonService } from '../../services/common/common.service';

@Controller()
export class HealthCheckController {
  constructor(private readonly commonService: CommonService) {}

  @Get()
  @ApiTags('info')
  @ApiOperation({ summary: 'Check the health of the service' })
  async checkHealth() {
    try {
      const blockchainInfo = await this.commonService.getBlockchainInfo();
      return okResponse({
        trackerBlockHeight:
          await this.commonService.getLastProcessedBlockHeight(),
        nodeBlockHeight: blockchainInfo?.blocks || null,
        latestBlockHeight: blockchainInfo?.headers || null,
      });
    } catch (e) {
      return errorResponse(e);
    }
  }
}
