import { Command, InquirerService, Option } from 'nest-commander';
import { getNft, getUtxos, logerror } from 'src/common';
import {
  ConfigService,
  getProviders,
  SpendService,
  WalletService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import {
  toTokenAddress,
  Cat721NftInfo,
  Cat721Metadata,
  singleSendNft,
  validteSupportedAddress,
} from '@cat-protocol/cat-sdk-v2';
import { findCollectionInfoById } from 'src/collection';
import { Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';

interface SendNftCommandOptions extends BoardcastCommandOptions {
  id: string;
  localId: bigint;
  config?: string;
}

@Command({
  name: 'sendNft',
  description: 'Send Nft',
})
export class SendNftCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly inquirer: InquirerService,
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }
  async cat_cli_run(
    inputs: string[],
    options?: SendNftCommandOptions,
  ): Promise<void> {
    if (!options.id) {
      logerror('expect a tokenId option', new Error());
      return;
    }
    try {
      const collectionInfo = await findCollectionInfoById(
        this.configService,
        options.id,
      );

      if (!collectionInfo) {
        throw new Error(
          `No collection info found for collectionId: ${options.id}`,
        );
      }

      let receiver: string;
      try {
        receiver = inputs[0];

        if (!validteSupportedAddress(receiver)) {
          console.error(`Invalid address type: ${receiver}`);
          return;
        }
      } catch (error) {
        console.error(`Invalid receiver address: "${receiver}" `);
        return;
      }

      await this.send(collectionInfo, receiver, options);
      return;
    } catch (error) {
      logerror(`send nft failed!`, error);
    }
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

  async send(
    collectionInfo: Cat721NftInfo<Cat721Metadata>,
    receiver: string,
    options: SendNftCommandOptions,
  ) {
    const address = await this.walletService.getAddress();

    const feeRate = await this.getFeeRate();

    const nft = await getNft(
      this.configService,
      collectionInfo,
      options.localId,
    );

    if (!nft) {
      console.error(`No nft localId = ${options.localId} found!`);
      return;
    }

    if (nft.state.ownerAddr !== toTokenAddress(address)) {
      console.log(
        `${collectionInfo.collectionId}:${options.localId} nft is not owned by your address ${address}`,
      );
      return;
    }
    const { chainProvider, utxoProvider } = getProviders(
      this.configService,
      this.walletService,
    );
    const result = await singleSendNft(
      this.walletService,
      utxoProvider,
      chainProvider,
      collectionInfo.minterAddr,
      [nft],
      [Ripemd160(toTokenAddress(receiver))],
      feeRate,
    );

    if (result) {
      const sendTx = result.sendTx.extractTransaction();
      console.log(
        `Sending ${collectionInfo.collectionId}:${options.localId} nft  to ${receiver} \nin txid: ${sendTx.getId()}`,
      );
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
    flags: '-l, --localId [localId]',
    description: 'localId of the nft',
  })
  parseLocalId(val: string): bigint {
    try {
      return BigInt(val);
    } catch (error) {
      throw new Error(`Invalid localId: ${val}`);
    }
  }
}
