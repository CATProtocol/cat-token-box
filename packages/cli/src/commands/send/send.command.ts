import { Command, InquirerService, Option } from 'nest-commander';
import { getTokens, logerror, needRetry, unScaleByDecimals } from 'src/common';
import {
  ConfigService,
  getProviders,
  SpendService,
  WalletService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import { RetrySendQuestionAnswers } from 'src/questions/retry-send.question';
import { findTokenInfoById, scaleMetadata } from 'src/token';
import Decimal from 'decimal.js';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import {
  Cat20TokenInfo,
  OpenMinterCat20Meta,
  singleSend,
  mergeCat20Utxo,
  pick,
  toTokenAddress,
  isP2TR,
  isP2WPKH,
} from '@cat-protocol/cat-sdk-v2';

interface SendCommandOptions extends BoardcastCommandOptions {
  id: string;
  address: string;
  amount: bigint;
  config?: string;
}

@Command({
  name: 'send',
  description: 'Send tokens',
})
export class SendCommand extends BoardcastCommand {
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
    options?: SendCommandOptions,
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

      let receiver: string;
      let amount: bigint;
      try {
        receiver = inputs[0];

        if (!isP2TR(receiver) && !isP2WPKH(receiver)) {
          console.error(`Invalid address type: ${receiver}`);
          return;
        }
      } catch (error) {
        console.error(`Invalid receiver address: "${receiver}" `);
        return;
      }

      const scaledMetadata = scaleMetadata(token.metadata);

      try {
        const d = new Decimal(inputs[1]).mul(
          Math.pow(10, scaledMetadata.decimals),
        );
        amount = BigInt(d.toString());
      } catch (error) {
        logerror(`Invalid amount: "${inputs[1]}"`, error);
        return;
      }

      do {
        try {
          await this.send(token, receiver, amount, address);
          return;
        } catch (error) {
          if (needRetry(error)) {
            // if send token failed, we request to retry
            const { retry } = await this.inquirer.ask<RetrySendQuestionAnswers>(
              'retry_send_question',
              {},
            );

            if (retry === 'abort') {
              return;
            }
            console.warn(`retry to send token [${token.metadata.symbol}] ...`);
          } else {
            throw error;
          }
        }
      } while (true);
    } catch (error) {
      logerror(`send token failed!`, error);
    }
  }

  async send(
    tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta>,
    receiver: string,
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

    cat20Utxos = pick(cat20Utxos, amount);

    if (cat20Utxos.length === 0) {
      console.warn('Insufficient token balance!');
      return;
    }

    const { chainProvider, utxoProvider } = getProviders(
      this.configService,
      this.walletService,
    );

    if (cat20Utxos.length > 2) {
      console.info(`Merging your [${tokenInfo.metadata.symbol}] tokens ...`);
      const { cat20Utxos: newCat20Utxos } = await mergeCat20Utxo(
        this.walletService,
        utxoProvider,
        chainProvider,
        tokenInfo.minterAddr,
        cat20Utxos,
        feeRate,
      );
      cat20Utxos = newCat20Utxos;
    }

    cat20Utxos = pick(cat20Utxos, amount);
    const result = await singleSend(
      this.walletService,
      utxoProvider,
      chainProvider,
      tokenInfo.minterAddr,
      cat20Utxos,
      [
        {
          address: toTokenAddress(receiver),
          amount: amount,
        },
      ],
      toTokenAddress(address),
      feeRate,
    );

    if (result) {
      this.spendService.updateTxsSpends([
        result.guardTx.extractTransaction(),
        result.sendTx.extractTransaction(),
      ]);

      console.log(
        `Sending ${unScaleByDecimals(amount, tokenInfo.metadata.decimals)} ${tokenInfo.metadata.symbol} tokens to ${receiver} \nin txid: ${result.sendTxId}`,
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
