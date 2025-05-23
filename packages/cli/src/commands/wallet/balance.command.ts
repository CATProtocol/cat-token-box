import { Option, SubCommand } from 'nest-commander';
import {
  getBalance,
  getAllBalance,
  logerror,
  unScaleByDecimals,
  getTrackerStatus,
} from 'src/common';
import { BaseCommand, BaseCommandOptions } from '../base.command';
import { ConfigService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';
import { findTokenInfoById } from 'src/token';
import { table } from './table';
import Decimal from 'decimal.js';

/**
 * balance command options
 */
interface BalanceCommandOptions extends BaseCommandOptions {
  id?: string;
}

/**
 * Get cat20 token balance command
 * @example
 * cat-cli wallet balance
 * cat-cli wallet balance -i 45ee725c2c5993b3e4d308842d87e973bf1951f5f7a804b21e4dd964ecd12d6b_0
 */
@SubCommand({
  name: 'balances',
  description: 'Get balances of all tokens',
})
export class BalanceCommand extends BaseCommand {
  constructor(
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(walletService, configService);
  }

  async checkTrackerStatus() {
    const status = await getTrackerStatus(this.configService);
    if (status instanceof Error) {
      throw new Error('tracker status is abnormal');
    }

    const { trackerBlockHeight, latestBlockHeight } = status;

    if (trackerBlockHeight < latestBlockHeight) {
      console.warn('tracker is behind latest blockchain height');
      console.warn(
        `processing ${trackerBlockHeight}/${latestBlockHeight}: ${new Decimal(trackerBlockHeight).div(latestBlockHeight).mul(100).toFixed(0)}%`,
      );
    }
  }
  async cat_cli_run(
    passedParams: string[],
    options?: BalanceCommandOptions,
  ): Promise<void> {
    try {
      const address = await this.walletService.getAddress();

      if (options.id) {
        const tokenInfo = await findTokenInfoById(
          this.configService,
          options.id,
        );

        if (!tokenInfo) {
          logerror(`No token found for tokenId: ${options.id}`, new Error());
          await this.checkTrackerStatus();
          return;
        }

        const balance = await getBalance(
          this.configService,
          tokenInfo,
          address,
        );

        console.log(
          table([
            {
              tokenId: balance.tokenId,
              symbol: balance.symbol,
              balance: unScaleByDecimals(
                balance.confirmed,
                tokenInfo.metadata.decimals,
              ),
            },
          ]),
        );
      } else {
        const balances = await getAllBalance(this.configService, address);

        if (balances.length === 0) {
          console.log('No tokens found!');
          await this.checkTrackerStatus();
          return;
        }

        const all = await Promise.all(
          balances.map(async (balance) => {
            const metadata = await findTokenInfoById(
              this.configService,
              balance.tokenId,
            );

            return {
              tokenId: balance.tokenId,
              symbol: balance.symbol,
              balance: unScaleByDecimals(
                balance.confirmed,
                metadata.metadata.decimals,
              ),
            };
          }),
        );

        console.log(table(all));
      }
    } catch (error) {
      logerror('Get Balance failed!', error);
    }
  }

  @Option({
    flags: '-i, --id [tokenId]',
    description: 'ID of the token',
  })
  parseId(val: string): string {
    return val;
  }
}
