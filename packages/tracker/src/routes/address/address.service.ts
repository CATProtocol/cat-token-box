import { Injectable } from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { xOnlyPubKeyToAddress } from '../../common/utils';
import { CommonService } from '../../services/common/common.service';

@Injectable()
export class AddressService {
  constructor(
    private readonly commonService: CommonService,
    private readonly tokenService: TokenService,
  ) {}

  async getTokenBalances(ownerAddr: string) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const utxos = await this.tokenService.queryTokenUtxosByOwnerAddress(
      lastProcessedHeight,
      ownerAddr,
    );
    const tokenBalances = this.tokenService.groupTokenBalances(utxos);
    const balances = [];
    for (const tokenPubKey in tokenBalances) {
      const tokenAddr = xOnlyPubKeyToAddress(tokenPubKey);
      const tokenInfo =
        await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(tokenAddr);
      if (tokenInfo) {
        balances.push({
          tokenId: tokenInfo.tokenId,
          confirmed: tokenBalances[tokenPubKey].toString(),
        });
      }
    }
    return { balances, trackerBlockHeight: lastProcessedHeight };
  }
}
