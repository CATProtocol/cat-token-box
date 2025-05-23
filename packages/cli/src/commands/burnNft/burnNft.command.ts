import { Command, InquirerService, Option } from 'nest-commander';
import { getNft, logerror } from 'src/common';
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
  Cat721Metadata,
  Cat721NftInfo,
  burnNft,
} from '@cat-protocol/cat-sdk-v2';
import { BurnNftConfirmQuestionAnswers } from 'src/questions/burnNft-confirm.question';
import { findCollectionInfoById } from 'src/collection';

/**
 * burnNft command options
 */
interface BurnNftCommandOptions extends BoardcastCommandOptions {
  /** token Id */
  id: string;
  /** local Id of Nft */
  localId: bigint;
  /** specify a customized configuration file */
  config?: string;
}

/**
 * Burn Nft command
 * @example
 * cat-cli burnNft -i b74d9d31d92794abd38296d2f8c61a1f7dca040f8b967de46973b62ed1c8e026_0 -l 0
 */
@Command({
  name: 'burnNft',
  description: 'burn nft',
})
export class BurnNftCommand extends BoardcastCommand {
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
    options?: BurnNftCommandOptions,
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
        throw new Error(`No collection info found for tokenId: ${options.id}`);
      }

      const answers = await this.inquirer.ask<BurnNftConfirmQuestionAnswers>(
        'burnNft_confirm_question',
        {},
      );

      if (!answers.confirm) {
        return;
      }

      console.warn(`try to burn nft [${collectionInfo.metadata.symbol}] ...`);

      await this.burn(collectionInfo, options.localId);
    } catch (error) {
      logerror(`burn token failed!`, error);
    }
  }

  async burn(nftInfo: Cat721NftInfo<Cat721Metadata>, localId: bigint) {
    const feeRate = await this.getFeeRate();

    const nft = await getNft(this.configService, nftInfo, localId);

    if (!nft) {
      console.error(`No nft localId = ${localId} found!`);
      return;
    }

    const { chainProvider, utxoProvider } = getProviders(
      this.configService,
      this.walletService,
    );

    const result = await burnNft(
      this.walletService,
      utxoProvider,
      chainProvider,
      nftInfo.minterAddr,
      [nft],
      feeRate,
    );

    if (result) {
      const burnTx = result.burnTx.extractTransaction();
      this.spendService.updateTxsSpends([
        result.guardTx.extractTransaction(),
        burnTx,
      ]);

      console.log(
        `Nft ${nftInfo.metadata.symbol}:${localId} burn \nin txid: ${burnTx.getId()}`,
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
