import { sendToken } from "./commands/send/ft";
import { mergeTokens } from "./commands/send/merge";
import { pick, pickLargeFeeUtxo } from "./commands/send/pick";
import {
  broadcast,
  btc,
  getTokens,
  getUtxos,
  logerror,
  TokenMetadata,
  unScaleByDecimals,
} from "./common";
import { ConfigService, SpendService } from "./providers";
import { WalletService } from "./providers/walletService";

export async function send(
  token: TokenMetadata,
  receiver: btc.Address,
  amount: bigint,
  address: btc.Address,
  configService: ConfigService,
  walletService: WalletService,
  spendService: SpendService,
  feeRate?: number,
) {
  // const feeRate = await this.getFeeRate();

  let feeUtxos = await getUtxos(configService, walletService, address);

  feeUtxos = feeUtxos.filter((utxo) => {
    return spendService.isUnspent(utxo);
  });

  if (feeUtxos.length === 0) {
    console.warn("Insufficient satoshis balance!");
    // return;
  }

  const res = await getTokens(configService, spendService, token, address);

  if (res === null) {
    return;
  }

  const { contracts } = res;

  let tokenContracts = pick(contracts, amount);

  if (tokenContracts.length === 0) {
    console.warn("Insufficient token balance!");
    return;
  }

  const cachedTxs: Map<string, btc.Transaction> = new Map();
  if (tokenContracts.length > 4) {
    console.info(`Merging your [${token.info.symbol}] tokens ...`);
    const [mergedTokens, newfeeUtxos, e] = await mergeTokens(
      configService,
      walletService,
      spendService,
      feeUtxos,
      feeRate,
      token,
      tokenContracts,
      address,
      cachedTxs,
    );

    if (e instanceof Error) {
      logerror("merge token failed!", e);
      return;
    }

    tokenContracts = mergedTokens;
    feeUtxos = newfeeUtxos;
  }

  const feeUtxo = pickLargeFeeUtxo(feeUtxos);

  const result = await sendToken(
    configService,
    walletService,
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
      configService,
      walletService,
      result.commitTx.uncheckedSerialize(),
    );

    // if (commitTxId instanceof Error) {
    //   throw commitTxId;
    // }

    // spendService.updateSpends(result.commitTx);

    // const revealTxId = await broadcast(
    //   configService,
    //   walletService,
    //   result.revealTx.uncheckedSerialize(),
    // );

    // if (revealTxId instanceof Error) {
    //   throw revealTxId;
    // }

    // spendService.updateSpends(result.revealTx);

    console.log(
      `Sending ${unScaleByDecimals(amount, token.info.decimals)} ${token.info.symbol} tokens to ${receiver} \nin txid: ${result.revealTx.id}`,
    );
  }

  return result;
}
