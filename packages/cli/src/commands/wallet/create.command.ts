import { Option, InquirerService, SubCommand } from 'nest-commander';
import { BaseCommand, BaseCommandOptions } from '../base.command';
import { logerror, Wallet } from 'src/common';
import { ConfigService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bip39 from 'bip39';

interface CreateCommandOptions extends BaseCommandOptions {
  name: string;
  path_index: number;
  mnemonic: string;
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

      const path_index = options.path_index
        ? options.path_index
        : 0;

      const mnemonic = options.mnemonic
        ? options.mnemonic
        : bip39.generateMnemonic();

      const wallet: Wallet = {
        accountPath: `m/86'/0'/0'/0/${path_index}`,
        name: name,
        mnemonic: mnemonic,
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
  @Option({
    flags: '-p,--path_index [path_index]',
    description: 'path index',
  })
  parsePathIndex(val: number): number {
    if (!val || val < 0) {
      logerror("path index can't be empty!", new Error('invalid path_index option'));
      process.exit(0);
    }
    return val;
  }

  @Option({
    flags: '-m,--mnemonic [mnemonic]',
    description: 'mnemonic',
  })
  parseMnemonic(val: string): string {
    if (!val) {
      logerror("mnemonic can't be empty!", new Error('invalid mnemonic option'));
      process.exit(0);
    }
    return val;
  }
}