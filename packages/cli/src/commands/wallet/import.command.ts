import { SubCommand, Option } from 'nest-commander';
import { BaseCommand, BaseCommandOptions } from '../base.command';
import { log, logerror } from 'src/common';
import { ConfigService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';

interface ImportCommandOptions extends BaseCommandOptions {
  create: boolean;
}

@SubCommand({
  name: 'export',
  description: 'Export wallet to a RPC node.',
})
export class ImportCommand extends BaseCommand {
  constructor(
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(walletService, configService);
  }
  async cat_cli_run(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    inputs: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: ImportCommandOptions,
  ): Promise<void> {
    try {
      if (!this.configService.useRpc()) {
        log('Please config your rpc first!');
        return;
      }
      console.log('exporting address to the RPC node ... ');

      const success = await this.walletService.importWallet(options.create);

      if (success) {
        console.log('successfully.');
      }
    } catch (error) {
      logerror('exporting address to the RPC node failed!', error);
    }
  }

  @Option({
    flags: '--create [create]',
    defaultValue: false,
    description: 'create watch only wallet before import address',
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseCreate(val: string): boolean {
    return true;
  }
}
