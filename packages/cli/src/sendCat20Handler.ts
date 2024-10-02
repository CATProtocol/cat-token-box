import { UTXO } from "scrypt-ts";
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
  feeUtxos: UTXO[],
  isBroadcast: boolean,
  feeRate?: number,

) {
  // const feeRate = await this.getFeeRate();

  // let feeUtxos = await getUtxos(configService, walletService, address);

  // console.log("========feeUtxos ori+++++++");
  // for (const utxo of feeUtxos) {
  //   console.log("utxo: ", utxo);
  // }

  // feeUtxos = feeUtxos.filter((utxo) => {
  //   return spendService.isUnspent(utxo);
  // });

  if (feeUtxos.length === 0) {
    console.log("Insufficient satoshis balance!");
    // throw new Error("Insufficient satoshis balance!");
    return { errorCode: '-1000', result: null};
  }

  const res = await getTokens(configService, spendService, token, address);

  if (res === null) {
    return { errorCode: '-9999', errorMsg: "getTokens nil", result: null };
  }

  const { contracts } = res;

  let tokenContracts = pick(contracts, amount);

  console.log("Picked tokenContracts: ", tokenContracts.length, contracts.length);

  if (tokenContracts.length === 0) {
    console.log("Insufficient token balance!");
    // throw new Error("Insufficient token balance!");
    return { errorCode: '-1001', result: null };
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
      console.info("merge token failed!", e);
      // throw new Error("merge token failed! " + e);
      return { errorCode: '-1002', errorMsg: e, result: null };
    }

    tokenContracts = mergedTokens;
    feeUtxos = newfeeUtxos;
  }
  console.log("pickLargeFeeUtxo");

  const feeUtxo = pickLargeFeeUtxo(feeUtxos);
  console.log("after pickLargeFeeUtxo");

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
  console.log("sendToken");

  if (result) {
    if (isBroadcast) {
      const commitTxId = await broadcast(
        configService,
        walletService,
        result.commitTx.uncheckedSerialize(),
      );

      if (commitTxId instanceof Error) {
        throw commitTxId;
      }

      spendService.updateSpends(result.commitTx);

      const revealTxId = await broadcast(
        configService,
        walletService,
        result.revealTx.uncheckedSerialize(),
      );

      if (revealTxId instanceof Error) {
        throw revealTxId;
      }

      spendService.updateSpends(result.revealTx);
    }

    console.log(
      `Sending ${unScaleByDecimals(amount, token.info.decimals)} ${token.info.symbol} tokens to ${receiver} \nin txid: ${result.revealTx.id}`,
    );
  }
  
  return { result: result};
}


export async function sendCat20(
  token: any,
  receiver: btc.Address,
  amount: string,
  senderAddress: btc.Address,
  configService: ConfigService,
  walletService: WalletService,
  spendService: SpendService,
  utxos: UTXO[],
  isBroadcast: boolean,
  feeRate: number,
) {
  try {
    const result = await send(
      token,
      receiver,
      BigInt(amount),
      senderAddress,
      configService,
      walletService,
      spendService,
      utxos,
      isBroadcast,
      feeRate,
    );

    if (result.errorCode) {
      return { errorCode: result.errorCode, errorMsg: result.errorMsg};
    }

    return {result: result.result};
    

  } catch (error) {
    console.log("sendCat20 -- ERROR ---", error);
    // throw error;
    return { errorCode: '-9999', errorMsg: error};
     
  }
}


export async function estFeeSendCat20(
  token: any,
  amount: string,
  senderAddress: btc.Address,
  configService: ConfigService,
  spendService: SpendService,
) {
  try {
    return await estCAT20UTXOs(
      token,
      BigInt(amount),
      senderAddress,
      configService,
      spendService,
    );
  } catch (error) {
    console.log("estFeeSendCat20 -- ERROR ---", error);
    throw error;
  }
}


export async function estCAT20UTXOs(
  token: TokenMetadata,
  amount: bigint,
  address: btc.Address,
  configService: ConfigService,
  spendService: SpendService,
) {
  // const feeRate = await this.getFeeRate();

  // let feeUtxos = await getUtxos(configService, walletService, address);

  // console.log("========feeUtxos ori+++++++");
  // for (const utxo of feeUtxos) {
  //   console.log("utxo: ", utxo);
  // }

  // feeUtxos = feeUtxos.filter((utxo) => {
  //   return spendService.isUnspent(utxo);
  // });

  // if (feeUtxos.length === 0) {
  //   console.log("Insufficient satoshis balance!");
  //   return;
  // }

  const res = await getTokens(configService, spendService, token, address);
  if (res === null) {
    throw new Error("List token contract is empty");
  }

  const { contracts } = res;
  let tokenContracts = pick(contracts, amount);
  console.log("estCAT20UTXOs Picked tokenContracts: ", tokenContracts.length, contracts.length);

  return tokenContracts.length;
}




