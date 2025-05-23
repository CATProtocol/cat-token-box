import { Command, Option } from 'nest-commander';
import {
  getUtxos,
  logerror,
  generateCollectionMerkleTree,
  getNFTMinter,
  isCAT721OpenMinter,
} from 'src/common';
import {
  ConfigService,
  getProviders,
  SpendService,
  WalletService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import { findCollectionInfoById } from 'src/collection';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import { isAbsolute, join } from 'path';
import { accessSync, constants, existsSync, readFileSync } from 'fs';
import {
  CAT721MerkleLeaf,
  catToXOnly,
  isP2TR,
  MerkleProof,
  mintNft,
  ProofNodePos,
  toTokenAddress,
} from '@cat-protocol/cat-sdk-v2';

/**
 * mintNft command options
 */
interface MintNftCommandOptions extends BoardcastCommandOptions {
  /** nft collection Id */
  id: string;
  /** specify a customized resource directory */
  resource?: string;
  /** specify a customized resource mime type */
  type?: string;
}

@Command({
  name: 'mintNft',
  description: 'Mint a NFT token',
})
export class MintNftCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }

  async cat_cli_run(
    passedParams: string[],
    options?: MintNftCommandOptions,
  ): Promise<void> {
    try {
      if (!options.id) {
        throw new Error('expect a ID option');
      }

      const resourceDir = options.resource
        ? options.resource
        : join(process.cwd(), 'resource');

      const contentType = options.type || 'image/png';

      const address = await this.walletService.getAddress();
      const collectionInfo = await findCollectionInfoById(
        this.configService,
        options.id,
      );

      if (!collectionInfo) {
        console.error(
          `No NFT collection info found for collectionId: ${options.id}`,
        );
        return;
      }

      const feeRate = await this.getFeeRate();
      const feeUtxos = await this.getFeeUTXOs(address);

      if (feeUtxos.length === 0) {
        console.warn('Insufficient satoshis balance!');
        return;
      }
      const pubKey = await this.walletService.getPublicKey();

      const { chainProvider, utxoProvider } = getProviders(
        this.configService,
        this.walletService,
      );

      const collectionMerkleTree = generateCollectionMerkleTree(
        collectionInfo.metadata.max,
        catToXOnly(pubKey, isP2TR(address)),
        contentType,
        resourceDir,
      );

      const minter = await getNFTMinter(
        this.configService,
        this.spendSerivce,
        chainProvider,
        collectionInfo,
        collectionMerkleTree,
      );

      if (minter == null) {
        console.error(
          `no NFT [${collectionInfo.metadata.symbol}] minter found`,
        );
        return;
      }

      const contentBody = this.readNFTFile(
        resourceDir,
        minter.state.nextLocalId,
        contentType,
      );

      const nftmetadata = this.readMetaData(
        resourceDir,
        minter.state.nextLocalId,
      );

      const index = Number(minter.state.nextLocalId);
      const oldLeaf = collectionMerkleTree.getLeaf(index);

      const newLeaf: CAT721MerkleLeaf = {
        commitScript: oldLeaf.commitScript,
        localId: oldLeaf.localId,
        isMined: true,
      };
      const updateLeafInfo = collectionMerkleTree.updateLeaf(newLeaf, index);

      const merkleInfo = collectionMerkleTree.getMerklePath(index);

      if (isCAT721OpenMinter(collectionInfo.metadata.minterMd5)) {
        const res = await mintNft(
          this.walletService,
          utxoProvider,
          chainProvider,
          minter,
          merkleInfo.neighbor as MerkleProof,
          merkleInfo.neighborType as ProofNodePos,
          updateLeafInfo.merkleRoot,
          {
            nftmetadata,
            contentBody,
            contentType,
          },
          collectionInfo.collectionId,
          collectionInfo.metadata,
          toTokenAddress(address),
          address,
          feeRate,
        );

        console.log(
          `Minting ${collectionInfo.metadata.symbol}:${minter.state.nextLocalId} NFT in txid: ${res.mintTxId} ...`,
        );
      }
    } catch (error) {
      logerror('mint failed!', error);
    }
  }

  @Option({
    flags: '-i, --id [tokenId]',
    description: 'ID of the token',
  })
  parseId(val: string): string {
    return val;
  }

  @Option({
    flags: '-r, --resource [resource]',
    description: 'resource of the minted nft token',
  })
  parseResource(val: string): string {
    if (!val) {
      logerror("resource can't be empty!", new Error());
      process.exit(0);
    }

    const resource = isAbsolute(val) ? val : join(process.cwd(), val);

    try {
      accessSync(resource, constants.R_OK);
      return resource;
    } catch (error) {
      logerror(`can\'t access resource file: ${resource}`, error);
      process.exit(0);
    }
  }

  @Option({
    flags: '-t, --type [type]',
    description: 'content type of the resource',
  })
  parseType(val: string): string {
    if (!val) {
      logerror("type can't be empty!", new Error());
      process.exit(0);
    }

    return val;
  }

  async getFeeUTXOs(address: string) {
    let feeUtxos = await getUtxos(
      this.configService,
      this.walletService,
      address,
    );

    feeUtxos = feeUtxos.filter((utxo) => {
      return this.spendService.isUnspent(utxo);
    });
    return feeUtxos;
  }

  readNFTFile(resource: string, localId: bigint, type: string) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, ext] = type.split('/');
    if (!ext) {
      throw new Error(`unknow type: ${type}`);
    }
    return readFileSync(join(resource, `${localId}.${ext}`)).toString('hex');
  }

  readMetaData(resource: string, localId: bigint): object | undefined {
    const metadata = {
      localId: localId,
    };

    try {
      const metadataFile = join(resource, `${localId}.json`);

      if (existsSync(metadataFile)) {
        const str = readFileSync(metadataFile).toString();
        const obj = JSON.parse(str);
        Object.assign(metadata, obj);
      }
    } catch (error) {
      logerror(`readMetaData FAIL, localId: ${localId}`, error);
    }
    return metadata;
  }
}
