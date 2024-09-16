import { Command, Option } from 'nest-commander';
import {
  MinterType,
  getUtxos,
  OpenMinterTokenInfo,
  logerror,
  logwarn,
  toP2tr,
  OpenMinterContract,
  log,
  checkTokenInfo,
  btc,
  scaleByDecimals,
} from 'src/common';
import { deploy, getMinterInitialTxState } from './ft';
import { ConfigService } from 'src/providers/configService';
import { SpendService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';
import { addTokenMetadata } from 'src/token';
import { openMint } from '../mint/ft.open-minter';
import { isAbsolute, join } from 'path';
import { accessSync, constants, readFileSync } from 'fs';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import { OpenMinterV2 } from '@cat-protocol/cat-smartcontracts';

interface DeployCommandOptions extends BoardcastCommandOptions {
  config?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  max?: bigint;
  limit?: bigint;
  premine?: bigint;
  metadata?: string;
}

function isEmptyOption(options: DeployCommandOptions) {
  const { config, name, symbol, decimals, max, limit, premine, metadata } =
    options;
  return (
    config === undefined &&
    name === undefined &&
    symbol === undefined &&
    decimals === undefined &&
    max === undefined &&
    limit === undefined &&
    premine === undefined &&
    metadata === undefined
  );
}

@Command({
  name: 'deploy',
  description: 'Deploy an open-mint fungible token (FT)',
})
export class DeployCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }

  async cat_cli_run(
    passedParams: string[],
    options?: DeployCommandOptions,
  ): Promise<void> {
    try {
      const address = this.walletService.getAddress();

      let info: OpenMinterTokenInfo;
      if (options.metadata) {
        const content = readFileSync(options.metadata).toString();
        info = JSON.parse(content);
      } else {
        info = options as unknown as OpenMinterTokenInfo;
      }

      if (isEmptyOption(options)) {
        logerror(
          'Should deploy with `--metadata=your.json` or with options like `--name=cat --symbol=cat --decimals=0 --max=21000000 --premine=0 --limit=1000` ',
          new Error('No metadata found'),
        );
        return;
      }

      const err = checkTokenInfo(info);

      if (err instanceof Error) {
        logerror('Invalid token metadata!', err);
        return;
      }

      const feeRate = await this.getFeeRate();

      const utxos = await getUtxos(
        this.configService,
        this.walletService,
        address,
      );

      if (utxos.length === 0) {
        console.warn('Insufficient satoshi balance!');
        return;
      }

      Object.assign(info, {
        minterMd5: OpenMinterV2.getArtifact().md5,
      });

      const result: {
        genesisTx: btc.Transaction;
        revealTx: btc.Transaction;
        tokenId: string;
        tokenAddr: string;
        minterAddr: string;
      } = await deploy(
        info as OpenMinterTokenInfo,
        feeRate,
        utxos,
        MinterType.OPEN_MINTER_V2,
        this.walletService,
        this.configService,
      );

      if (!result) {
        console.log(`deploying Token ${info.name} failed!`);
        return;
      }

      this.spendService.updateTxsSpends([result.genesisTx, result.revealTx]);

      console.log(`Token ${info.symbol} has been deployed.`);
      console.log(`TokenId: ${result.tokenId}`);
      console.log(`Genesis txid: ${result.genesisTx.id}`);
      console.log(`Reveal txid: ${result.revealTx.id}`);

      const metadata = addTokenMetadata(
        this.configService,
        result.tokenId,
        info,
        result.tokenAddr,
        result.minterAddr,
        result.genesisTx.id,
        result.revealTx.id,
      );

      // auto premine
      if (info.premine > 0n) {
        if (result.genesisTx.outputs.length === 3) {
          const minter: OpenMinterContract = {
            utxo: {
              txId: result.revealTx.id,
              script: result.revealTx.outputs[1].script.toHex(),
              satoshis: result.revealTx.outputs[1].satoshis,
              outputIndex: 1,
            },
            state: getMinterInitialTxState(toP2tr(metadata.tokenAddr), info),
          };

          const scalePremine = scaleByDecimals(info.premine, info.decimals);

          const mintTxId = await openMint(
            this.configService,
            this.walletService,
            this.spendService,
            feeRate,
            [
              {
                txId: result.genesisTx.id,
                script: result.genesisTx.outputs[2].script.toHex(),
                satoshis: result.genesisTx.outputs[2].satoshis,
                outputIndex: 2,
              },
            ],
            metadata,
            2,
            minter,
            scalePremine,
          );

          if (mintTxId instanceof Error) {
            logerror(`minting premine tokens failed!`, mintTxId);
            return;
          }

          log(
            `Minting ${info.premine} ${info.symbol} as premine in txId: ${mintTxId}`,
          );
        } else {
          logwarn(`Insufficient satoshis to premine`, new Error());
        }
      }
    } catch (error) {
      logerror('Deploy failed!', error);
    }
  }

  @Option({
    flags: '-n, --name [name]',
    name: 'name',
    description: 'token name',
  })
  parseName(val: string): string {
    if (!val) {
      logerror("Name can't be empty!", new Error('Empty symbol'));
      process.exit(0);
    }
    return val;
  }

  @Option({
    flags: '-s, --symbol [symbol]',
    name: 'symbol',
    description: 'token symbol',
  })
  parseSymbol(val: string): string {
    if (!val) {
      logerror("Symbol can't be empty!", new Error('Empty symbol'));
      process.exit(0);
    }

    return val;
  }

  @Option({
    flags: '-d, --decimals [decimals]',
    name: 'decimals',
    description: 'token decimals',
  })
  parseDecimals(val: string): number {
    if (!val) {
      return 0;
    }

    try {
      const decimals = parseInt(val);
      if (isNaN(decimals)) {
        logwarn('Invalid decimals, use defaut 0', new Error());
      }
      return decimals;
    } catch (error) {
      logwarn('Invalid decimals, use defaut 0', error);
    }
    return 0;
  }

  @Option({
    flags: '-l, --limit [limit]',
    name: 'limit',
    description: 'limit of per mint',
  })
  parseLimit(val: string): bigint {
    if (!val) {
      return BigInt(1000);
    }

    try {
      return BigInt(val);
    } catch (error) {
      logwarn('Invalid limit, use defaut 1000n', error);
    }
    return BigInt(1000);
  }

  @Option({
    flags: '-m, --max [max]',
    name: 'max',
    description: 'token max supply',
  })
  parseMax(val: string): bigint {
    if (!val) {
      logerror('Invalid token max supply!', new Error('Empty max supply'));
      process.exit(0);
    }
    try {
      return BigInt(val);
    } catch (error) {
      logerror('Invalid token max supply!', error);
      process.exit(0);
    }
  }

  @Option({
    flags: '-p, --premine [premine]',
    name: 'premine',
    description: 'token premine',
  })
  parsePremine(val: string): bigint {
    if (!val) {
      return BigInt(0);
    }
    try {
      return BigInt(val);
    } catch (error) {
      logerror('Invalid token premine!', error);
      process.exit(0);
    }
  }

  @Option({
    flags: '-m, --metadata [metadata]',
    name: 'metadata',
    description: 'token metadata',
  })
  parseMetadata(val: string): string {
    if (!val) {
      logerror("metadata can't be empty!", new Error());
      process.exit(0);
    }

    const metadata = isAbsolute(val) ? val : join(process.cwd(), val);

    try {
      accessSync(metadata, constants.R_OK);
      return metadata;
    } catch (error) {
      logerror(`can\'t access metadata file: ${metadata}`, error);
      process.exit(0);
    }
  }
}
