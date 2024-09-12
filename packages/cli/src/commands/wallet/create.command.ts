import { Option, InquirerService, SubCommand } from 'nest-commander';
import { BaseCommand, BaseCommandOptions } from '../base.command';
import { logerror, Wallet } from 'src/common';
import { ConfigService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bip39 from 'bip39';

interface CreateCommandOptions extends BaseCommandOptions {
  name: string;
}

@SubCommand({
  name: 'create',
  description: 'Create a wallet.',
})
export class CreateCommand extends BaseCommand {
  constructor(
    @Inject() private readonly inquirer: InquirerService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(walletService, configService, false);
  }
  async cat_cli_run(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    inputs: string[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CreateCommandOptions,
  ): Promise<void> {
    try {
      const walletFile = this.walletService.foundWallet();
      if (walletFile !== null) {
        logerror(`found an existing wallet: ${walletFile}`, new Error());
        return;
      }

      const name = options.name
        ? options.name
        : `cat-${randomBytes(4).toString('hex')}`;

      const wallet: Wallet = {
        accountPath: "m/86'/0'/0'/0/0",
        name: name,
        mnemonic: bip39.generateMnemonic(),
      };

      this.walletService.createWallet(wallet);

      console.log('Your wallet mnemonic is: ', wallet.mnemonic);

      console.log('exporting address to the RPC node ... ');

      const success = await this.walletService.importWallet(true);
      if (success) {
        console.log('successfully.');
      }
    } catch (error) {
      logerror('Create wallet failed!', error);
    }
  }

  @Option({
    flags: '-n,--name [name]',
    description: 'wallet name',
  })
  parseName(val: string): string {
    if (!val) {
      logerror("wallet name can't be empty!", new Error('invalid name option'));
      process.exit(0);
    }

    return val;
  }
}
