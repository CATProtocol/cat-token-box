import { Command, InquirerService, Option } from 'nest-commander';
import { getTokens, logerror, unScaleByDecimals } from 'src/common';
import {
  ConfigService,
  getProviders,
  SpendService,
  WalletService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import { findTokenInfoById, scaleMetadata } from 'src/token';
import Decimal from 'decimal.js';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import {
  Cat20TokenInfo,
  OpenMinterCat20Meta,
  burn,
  burnPick,
} from '@cat-protocol/cat-sdk-v2';
import { BurnConfirmQuestionAnswers } from 'src/questions/burn-confirm.question';

interface BurnCommandOptions extends BoardcastCommandOptions {
  id: string;
  amount: bigint;
  config?: string;
}

@Command({
  name: 'burn',
  description: 'burn tokens',
})
export class BurnCommand extends BoardcastCommand {
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
    options?: BurnCommandOptions,
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

      let amount: bigint;

      const scaledMetadata = scaleMetadata(token.metadata);

      try {
        const d = new Decimal(inputs[0]).mul(
          Math.pow(10, scaledMetadata.decimals),
        );
        amount = BigInt(d.toString());
      } catch (error) {
        logerror(`Invalid amount: "${inputs[1]}"`, error);
        return;
      }

      const answers = await this.inquirer.ask<BurnConfirmQuestionAnswers>(
        'burn_confirm_question',
        {},
      );

      if (!answers.confirm) {
        return;
      }

      console.warn(`try to burn token [${token.metadata.symbol}] ...`);

      await this.burn(token, amount, address);
    } catch (error) {
      logerror(`burn token failed!`, error);
    }
  }

  async burn(
    tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta>,
    amount: bigint,
    address: string,
  ) {
    const feeRate = await this.getFeeRate();

    let cat20Utxos = await getTokens(
      this.configService,
      this.spendService,
      tokenInfo,
      address,
    );

    cat20Utxos = burnPick(cat20Utxos, amount);

    if (cat20Utxos.length === 0) {
      console.warn('Insufficient token balance!');
      return;
    }

    const { chainProvider, utxoProvider } = getProviders(
      this.configService,
      this.walletService,
    );

    const result = await burn(
      this.walletService,
      utxoProvider,
      chainProvider,
      tokenInfo.minterAddr,
      cat20Utxos,
      feeRate,
    );

    if (result) {
      const burnTx = result.burnTx.extractTransaction();
      this.spendService.updateTxsSpends([
        result.guardTx.extractTransaction(),
        burnTx,
      ]);

      console.log(
        `${unScaleByDecimals(amount, tokenInfo.metadata.decimals)} ${tokenInfo.metadata.symbol} tokens burn \nin txid: ${burnTx.getId()}`,
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
}
