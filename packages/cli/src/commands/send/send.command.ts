import { Command, InquirerService, Option } from 'nest-commander';
import {
  getUtxos,
  getTokens,
  TokenMetadata,
  broadcast,
  logerror,
  needRetry,
  OpenMinterTokenInfo,
  sleep,
  btc,
  unScaleByDecimals,
} from 'src/common';
import { sendToken } from './ft';
import { pick, pickLargeFeeUtxo } from './pick';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { Inject } from '@nestjs/common';
import { RetrySendQuestionAnswers } from 'src/questions/retry-send.question';
import { findTokenMetadataById, scaleConfig } from 'src/token';
import Decimal from 'decimal.js';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import { isMergeTxFail, mergeTokens } from './merge';

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
      const address = this.walletService.getAddress();
      const token = await findTokenMetadataById(this.configService, options.id);

      if (!token) {
        throw new Error(`No token metadata found for tokenId: ${options.id}`);
      }

      let receiver: btc.Address;
      let amount: bigint;
      try {
        receiver = btc.Address.fromString(inputs[0]);

        if (receiver.type !== 'taproot') {
          console.error(`Invalid address type: ${receiver.type}`);
          return;
        }
      } catch (error) {
        console.error(`Invalid receiver address: "${inputs[0]}" `);
        return;
      }

      const scaledInfo = scaleConfig(token.info as OpenMinterTokenInfo);

      try {
        const d = new Decimal(inputs[1]).mul(Math.pow(10, scaledInfo.decimals));
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
          // if merge failed, we can auto retry
          if (isMergeTxFail(error)) {
            logerror(`Merge [${token.info.symbol}] tokens failed.`, error);
            console.warn(`retry to merge [${token.info.symbol}] tokens ...`);
            await sleep(6);
            continue;
          }

          if (needRetry(error)) {
            // if send token failed, we request to retry
            const { retry } = await this.inquirer.ask<RetrySendQuestionAnswers>(
              'retry_send_question',
              {},
            );

            if (retry === 'abort') {
              return;
            }
            console.warn(`retry to send token [${token.info.symbol}] ...`);
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
    token: TokenMetadata,
    receiver: btc.Address,
    amount: bigint,
    address: btc.Address,
  ) {
    const feeRate = await this.getFeeRate();

    let feeUtxos = await getUtxos(
      this.configService,
      this.walletService,
      address,
    );

    feeUtxos = feeUtxos.filter((utxo) => {
      return this.spendService.isUnspent(utxo);
    });

    if (feeUtxos.length === 0) {
      console.warn('Insufficient satoshis balance!');
      return;
    }

    const res = await getTokens(
      this.configService,
      this.spendService,
      token,
      address,
    );

    if (res === null) {
      return;
    }

    const { contracts } = res;

    let tokenContracts = pick(contracts, amount);

    if (tokenContracts.length === 0) {
      console.warn('Insufficient token balance!');
      return;
    }

    const cachedTxs: Map<string, btc.Transaction> = new Map();
    if (tokenContracts.length > 4) {
      console.info(`Merging your [${token.info.symbol}] tokens ...`);
      const [mergedTokens, newfeeUtxos, e] = await mergeTokens(
        this.configService,
        this.walletService,
        this.spendService,
        feeUtxos,
        feeRate,
        token,
        tokenContracts,
        address,
        cachedTxs,
      );

      if (e instanceof Error) {
        logerror('merge token failed!', e);
        return;
      }

      tokenContracts = mergedTokens;
      feeUtxos = newfeeUtxos;
    }

    const feeUtxo = pickLargeFeeUtxo(feeUtxos);

    const result = await sendToken(
      this.configService,
      this.walletService,
      feeUtxo,
      feeRate,
      token,
      tokenContracts,
      address,
      receiver,
      amount,
      cachedTxs,
    );

    if (result) {
      const commitTxId = await broadcast(
        this.configService,
        this.walletService,
        result.commitTx.uncheckedSerialize(),
      );

      if (commitTxId instanceof Error) {
        throw commitTxId;
      }

      this.spendService.updateSpends(result.commitTx);

      const revealTxId = await broadcast(
        this.configService,
        this.walletService,
        result.revealTx.uncheckedSerialize(),
      );

      if (revealTxId instanceof Error) {
        throw revealTxId;
      }

      this.spendService.updateSpends(result.revealTx);

      console.log(
        `Sending ${unScaleByDecimals(amount, token.info.decimals)} ${token.info.symbol} tokens to ${receiver} \nin txid: ${result.revealTx.id}`,
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
