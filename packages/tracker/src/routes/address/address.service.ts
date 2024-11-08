import { Injectable } from '@nestjs/common';
import { TokenService } from '../token/token.service';
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

  private async getBalances(
    ownerAddrOrPkh: string,
    scope: TokenTypeScope.Fungible | TokenTypeScope.NonFungible,
  ) {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    const balances = await this.tokenService.queryTokenBalancesByOwnerAddress(
      lastProcessedHeight,
      ownerAddrOrPkh,
      scope,
    );
    return { balances, trackerBlockHeight: lastProcessedHeight };
  }
}
