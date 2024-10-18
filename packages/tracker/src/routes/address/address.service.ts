import { Injectable } from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { xOnlyPubKeyToAddress } from '../../common/utils';
import { CommonService } from '../../services/common/common.service';
import { TokenTypeScope } from '../../common/types';

@Injectable()
export class AddressService {
  constructor(
    private readonly commonService: CommonService,
    private readonly tokenService: TokenService,
  ) {}

  async getTokenBalances(ownerAddrOrPkh: string) {
    return this.getBalances(ownerAddrOrPkh, TokenTypeScope.Fungible);
  }

  async getCollectionBalances(ownerAddrOrPkh: string) {
    return this.getBalances(ownerAddrOrPkh, TokenTypeScope.NonFungible);
  }

  private async getBalances(ownerAddrOrPkh: string, scope: TokenTypeScope) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const utxos = await this.tokenService.queryTokenUtxosByOwnerAddress(
      lastProcessedHeight,
      ownerAddrOrPkh,
    );
    const tokenBalances = await this.tokenService.groupTokenBalances(utxos);
    const balances = [];
    for (const tokenPubKey in tokenBalances) {
      const tokenAddr = xOnlyPubKeyToAddress(tokenPubKey);
      const tokenInfo =
        await this.tokenService.getTokenInfoByTokenIdOrTokenAddress(
          tokenAddr,
          scope,
        );
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
