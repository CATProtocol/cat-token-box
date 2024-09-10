import { Option } from 'nest-commander';
import { BaseCommand, BaseCommandOptions } from './base.command';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { CliConfig, getFeeRate } from 'src/common';

export interface BoardcastCommandOptions extends BaseCommandOptions {
  maxFeeRate?: number;
  feeRate?: number;
}

export abstract class BoardcastCommand extends BaseCommand {
  constructor(
    protected readonly spendSerivce: SpendService,
    protected readonly walletService: WalletService,
    protected readonly configService: ConfigService,
  ) {
    super(walletService, configService);
  }

  override async run(
    passedParams: string[],
    options?: BaseCommandOptions,
  ): Promise<void> {
    await super.run(passedParams, options);
    this.spendSerivce.save();
  }

  protected takeConfig(options: BoardcastCommandOptions): CliConfig {
    const config = super.takeConfig(options);
    if (options.maxFeeRate) {
      Object.assign(config, {
        maxFeeRate: options.maxFeeRate,
      });
    }

    if (options.feeRate) {
      Object.assign(config, {
        feeRate: options.feeRate,
      });
    }
    return config;
  }

  @Option({
    flags: '--max-fee-rate [maxFeeRate]',
    description: 'max fee rate',
  })
  parseMaxFeeRate(val: string): number {
    try {
      return parseInt(val);
    } catch (error) {}
    return undefined;
  }

  @Option({
    flags: '--fee-rate [feeRate]',
    description: 'fee rate',
  })
  parseFeeRate(val: string): number {
    try {
      return parseInt(val);
    } catch (error) {}
    return undefined;
  }

  async getFeeRate(): Promise<number> {
    const feeRate = this.configService.getFeeRate();

    if (feeRate > 0) {
      return feeRate;
    }

    const networkFeeRate = await getFeeRate(
      this.configService,
      this.walletService,
    );

    const maxFeeRate = this.configService.getMaxFeeRate();

    if (maxFeeRate > 0) {
      return Math.min(maxFeeRate, networkFeeRate);
    }

    return networkFeeRate;
  }
}
