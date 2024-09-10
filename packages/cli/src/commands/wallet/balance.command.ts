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
import { findTokenMetadataById } from 'src/token';
import { table } from './table';
import Decimal from 'decimal.js';

interface BalanceCommandOptions extends BaseCommandOptions {
  id?: string;
}

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
      const address = this.walletService.getAddress();

      if (options.id) {
        const metadata = await findTokenMetadataById(
          this.configService,
          options.id,
        );

        if (!metadata) {
          logerror(`No token found for tokenId: ${options.id}`, new Error());
          await this.checkTrackerStatus();
          return;
        }

        const balance = await getBalance(this.configService, metadata, address);

        console.log(
          table([
            {
              tokenId: balance.tokenId,
              symbol: balance.symbol,
              balance: unScaleByDecimals(
                balance.confirmed,
                metadata.info.decimals,
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
            const metadata = await findTokenMetadataById(
              this.configService,
              balance.tokenId,
            );

            return {
              tokenId: balance.tokenId,
              symbol: balance.symbol,
              balance: unScaleByDecimals(
                balance.confirmed,
                metadata.info.decimals,
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
