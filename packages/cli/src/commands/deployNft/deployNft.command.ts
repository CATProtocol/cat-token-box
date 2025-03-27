import { Command, Option } from 'nest-commander';
import {
  logerror,
  generateCollectionMerkleTree,
  checkNftMetadata,
} from 'src/common';

import {
  getProviders,
  SpendService,
  WalletService,
  ConfigService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import { addCollectionInfo } from 'src/collection';
import { isAbsolute, join } from 'path';
import { accessSync, constants, lstatSync, readFileSync } from 'fs';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import {
  Cat721Metadata,
  deployNft,
  CAT721ClosedMinter,
  catToXOnly,
  isP2TR,
  CAT721OpenMinter,
} from '@cat-protocol/cat-sdk-v2';

interface DeployNftCommandOptions extends BoardcastCommandOptions {
  config?: string;
  name?: string;
  symbol?: string;
  description?: string;
  icon?: string;
  max?: bigint;
  premine?: bigint;
  metadata?: string;
  resource?: string;
  type?: string;
}

function isEmptyOption(options: DeployNftCommandOptions) {
  const { config, name, symbol, description, max, icon, metadata } = options;
  return (
    config === undefined &&
    name === undefined &&
    symbol === undefined &&
    description === undefined &&
    max === undefined &&
    icon === undefined &&
    metadata === undefined
  );
}

@Command({
  name: 'deployNft',
  description: 'Deploy an open-mint non-fungible token (NFT)',
})
export class DeployNftCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }

  async cat_cli_run(
    passedParams: string[],
    options?: DeployNftCommandOptions,
  ): Promise<void> {
    try {
      const address = await this.walletService.getAddress();
      const pubKey = await this.walletService.getPublicKey();

      let metadata: Cat721Metadata;
      if (options.metadata) {
        const content = readFileSync(options.metadata).toString();
        metadata = JSON.parse(content);
      } else {
        const { name, symbol, description, max, premine } = options;

        metadata = {
          name,
          symbol,
          description,
          max,
          premine,
        } as Cat721Metadata;
      }

      if (isEmptyOption(options)) {
        logerror(
          'Should deploy with `--metadata=your.json` or with options like `--name=cat721 --symbol=cat721 --description="this is cat721 nft" --max=2100` ',
          new Error('No metadata found'),
        );
        return;
      }

      const err = checkNftMetadata(metadata);

      if (err instanceof Error) {
        logerror('Invalid token metadata!', err);
        return;
      }

      const feeRate = await this.getFeeRate();

      Object.assign(metadata, {
        minterMd5: CAT721OpenMinter.artifact.md5,
      });

      const contentType = options.type || 'image/png';

      const icon = options.icon
        ? {
            type: contentType,
            body: options.icon,
          }
        : undefined;

      const { chainProvider, utxoProvider } = getProviders(
        this.configService,
        this.walletService,
      );

      const resourceDir = options.resource
        ? options.resource
        : join(process.cwd(), 'resource');

      const collectionMerkleTree = generateCollectionMerkleTree(
        metadata.max,
        catToXOnly(pubKey, isP2TR(address)),
        contentType,
        resourceDir,
      );

      const result = await deployNft(
        this.walletService,
        utxoProvider,
        chainProvider,
        metadata,
        collectionMerkleTree.merkleRoot,
        feeRate,
      );

      const genesisTx = result.genesisTx.extractTransaction();
      const revealTx = result.revealTx.extractTransaction();
      this.spendService.updateTxsSpends([genesisTx, revealTx]);

      console.log(`Nft collection ${metadata.symbol} has been deployed.`);
      console.log(`CollectionId: ${result.collectionId}`);
      console.log(`Genesis txid: ${result.genesisTxid}`);
      console.log(`Reveal txid: ${result.revealTxid}`);

      addCollectionInfo(
        this.configService,
        result.collectionId,
        metadata,
        result.collectionAddr,
        result.minterAddr,
        result.genesisTxid,
        result.revealTxid,
      );
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
    flags: '-d, --description [description]',
    name: 'description',
    description: 'description',
  })
  parseDescription(val: string): string {
    if (!val) {
      logerror("Description can't be empty!", new Error('Empty description'));
      process.exit(0);
    }

    return val;
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

  @Option({
    flags: '-i, --icon [icon]',
    name: 'icon',
    description: 'token icon',
  })
  parseIcon(val: string): string {
    if (!val) {
      logerror("icon can't be empty!", new Error());
      process.exit(0);
    }

    const iconFile = isAbsolute(val) ? val : join(process.cwd(), val);

    try {
      accessSync(iconFile, constants.R_OK);
      return readFileSync(iconFile).toString('hex');
    } catch (error) {
      logerror(`can\'t access iconFile file: ${iconFile}`, error);
      process.exit(0);
    }
  }

  @Option({
    flags: '-r, --resource [resource]',
    description: 'resource of the minted nft',
  })
  parseResource(val: string): string {
    if (!val) {
      logerror("resource can't be empty!", new Error());
      process.exit(0);
    }

    const resource = isAbsolute(val) ? val : join(process.cwd(), val);

    try {
      const stat = lstatSync(resource);

      if (stat.isDirectory()) {
        return resource;
      } else {
        throw new Error(`${resource} is not directory`);
      }
    } catch (error) {
      logerror(`can\'t access resource dir: ${resource}`, error);
      process.exit(0);
    }
  }

  @Option({
    flags: '-t, --type [type]',
    description: 'content type of the resource',
  })
  parseType(val: string): string {
    if (!val) {
      logerror("resource can't be empty!", new Error());
      process.exit(0);
    }

    return val;
  }

  @Option({
    flags: '-p, --premine [premine]',
    name: 'premine',
    description: 'premine nft',
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
    flags: '--openMint [openMint]',
    name: 'openMint',
    description: 'openMint nft',
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseOpenMint(_val: string): boolean {
    return true;
  }

  @Option({
    flags: '--parallel [parallel]',
    name: 'parallel',
    description: 'parallel closed mint',
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseParallel(_val: string): boolean {
    return true;
  }
}
