import { Command, Option } from 'nest-commander';
import { getUtxos, logerror, logwarn, checkTokenInfo, log } from 'src/common';
import { ConfigService } from 'src/providers/configService';
import { getProviders, SpendService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';
import { addTokenInfo } from 'src/token';
import { isAbsolute, join } from 'path';
import { accessSync, constants, readFileSync } from 'fs';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import {
  OpenMinterCat20Meta,
  CAT20OpenMinter,
  deploy,
} from '@cat-protocol/cat-sdk-v2';

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
      const address = await this.walletService.getAddress();

      let cat20Meta: OpenMinterCat20Meta;
      if (options.metadata) {
        const content = readFileSync(options.metadata).toString();
        cat20Meta = JSON.parse(content);
        Object.assign(cat20Meta, {
          minterMd5: CAT20OpenMinter.artifact.md5,
        });
      } else {
        const { name, symbol, decimals, premine, max, limit } = options;
        cat20Meta = {
          name,
          symbol,
          decimals,
          premine,
          max,
          limit,
          minterMd5: CAT20OpenMinter.artifact.md5,
        };
      }

      if (isEmptyOption(options)) {
        logerror(
          'Should deploy with `--metadata=your.json` or with options like `--name=cat --symbol=cat --decimals=0 --max=21000000 --premine=0 --limit=1000` ',
          new Error('No metadata found'),
        );
        return;
      }

      const err = checkTokenInfo(cat20Meta);

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

      const { chainProvider, utxoProvider } = getProviders(
        this.configService,
        this.walletService,
      );

      const result = await deploy(
        this.walletService,
        utxoProvider,
        chainProvider,
        cat20Meta,
        feeRate,
      );

      if (!result) {
        console.log(`deploying Token ${cat20Meta.name} failed!`);
        return;
      }

      console.log(`Token ${cat20Meta.symbol} has been deployed.`);
      console.log(`TokenId: ${result.tokenId}`);
      console.log(`Genesis txid: ${result.genesisTxid}`);
      console.log(`Reveal txid: ${result.revealTxid}`);

      const tokenInfo = addTokenInfo(
        this.configService,
        result.tokenId,
        cat20Meta,
        result.tokenAddr,
        result.minterAddr,
        result.genesisTxid,
        result.revealTxid,
      );

      // auto premine
      if (result.premineTx) {
        log(
          `Minting ${tokenInfo.metadata.premine} ${tokenInfo.metadata.symbol} as premine in txId: ${result.premineTx.extractTransaction().getId()}`,
        );
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
