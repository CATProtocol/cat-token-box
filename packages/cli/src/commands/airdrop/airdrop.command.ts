import { Command, Option } from 'nest-commander';
import { getTokens, logerror } from 'src/common';
import {
  ConfigService,
  getProviders,
  SpendService,
  WalletService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import { findTokenInfoById } from 'src/token';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import {
  Cat20TokenInfo,
  OpenMinterCat20Meta,
  int32,
  airdrop,
  AirdropProcess,
  validteSupportedAddress,
} from '@cat-protocol/cat-sdk-v2';
import { dirname, isAbsolute, join } from 'path';
import { accessSync, appendFileSync, constants, readFileSync } from 'fs';
interface AirdropCommandOptions extends BoardcastCommandOptions {
  id: string;
  file: string;
  config?: string;
}

@Command({
  name: 'airdrop',
  description: 'Airdrop tokens',
})
export class AirdropCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }
  async cat_cli_run(
    inputs: string[],
    options?: AirdropCommandOptions,
  ): Promise<void> {
    if (!options.id) {
      logerror('expect a tokenId option', new Error());
      return;
    }
    try {
      const address = await this.walletService.getAddress();
      const token = await findTokenInfoById(this.configService, options.id);

      if (!token) {
        throw new Error(`No token metadata found for tokenId: ${options.id}`);
      }

      const receivers = AirdropCommand.readReceivers(options.file);

      await this.airdrop(options, token, receivers, address);
    } catch (error) {
      logerror(`send token failed!`, error);
    }
  }

  async airdrop(
    options: AirdropCommandOptions,
    tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta>,
    receivers: Array<{
      address: string;
      amount: int32;
    }>,
    address: string,
  ) {
    const feeRate = await this.getFeeRate();

    const cat20Utxos = await getTokens(
      this.configService,
      this.spendService,
      tokenInfo,
      address,
    );

    if (cat20Utxos.length === 0) {
      console.warn('Insufficient token balance!');
      return;
    }

    const { chainProvider, utxoProvider } = getProviders(
      this.configService,
      this.walletService,
    );

    const successFile = join(
      dirname(options.file),
      `success_${new Date().getTime()}.csv`,
    );

    let processedCount = 0;

    const cb: AirdropProcess = {
      onStart: () => {
        console.log('start airdrop ...');
      },
      onProcess: (receiver: {
        address: string;
        amount: int32;
        txId: string;
      }) => {
        processedCount++;
        console.log(
          `onProcess: ${processedCount}/${receivers.length}, txid: ${receiver.txId}`,
        );
        appendFileSync(
          successFile,
          `${receiver.amount},${receiver.address},${receiver.txId}\n`,
        );
      },

      onSuccess: (
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _success: Array<{
          address: string;
          amount: int32;
          txId: string;
        }>,
      ) => {},

      onWaitTxConfirm: (txId: string) => {
        console.log(`waiting tx ${txId} to be confirmed`);
      },
      onError: (err: Error) => {
        console.error(`onError`, err);
      },
    };

    const result = await airdrop(
      this.walletService,
      utxoProvider,
      chainProvider,
      tokenInfo.minterAddr,
      cat20Utxos,
      receivers,
      feeRate,
      cb,
    );

    console.log(`airdrop to ${result.success.length} receivers successfully`);
  }

  @Option({
    flags: '-i, --id [tokenId]',
    description: 'ID of the token',
  })
  parseId(val: string): string {
    return val;
  }

  @Option({
    flags: '-f, --file [file]',
    description: 'file of the airdrop',
  })
  parseFile(val: string): string {
    if (!val) {
      logerror("file can't be empty!", new Error());
      process.exit(0);
    }

    const file = isAbsolute(val) ? val : join(process.cwd(), val);

    try {
      accessSync(file, constants.R_OK);
      return file;
    } catch (error) {
      logerror(`can\'t access airdrop file: ${file}`, error);
      process.exit(0);
    }
  }

  static readReceivers(idsFile: string): Array<{
    address: string;
    amount: int32;
  }> {
    const str = readFileSync(idsFile).toString();
    const lines = str.split('\n');

    const receivers: Array<{
      address: string;
      amount: int32;
    }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line) {
        const [amountStr, address] = line.split(',');
        validteSupportedAddress(address);
        const amount = BigInt(amountStr);
        receivers.push({
          address,
          amount,
        });
      }
    }

    return receivers;
  }
}
