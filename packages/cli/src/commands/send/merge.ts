import {
  getConfirmations,
  sleep,
  btc,
  broadcast,
  log,
  TokenMetadata,
  TokenContract,
} from 'src/common';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { UTXO } from 'scrypt-ts';
import { calcTotalAmount, sendToken } from './ft';

async function feeSplitTx(
  configService: ConfigService,
  walletService: WalletService,
  feeUtxos: UTXO[],
  feeRate: number,
  count: number,
) {
  if (count === 1 && feeUtxos.length === 1) {
    return feeUtxos;
  }
  const address = walletService.getAddress();
  const splitFeeTx = new btc.Transaction();

  splitFeeTx.from(feeUtxos);

  function calcVsize(walletService: WalletService): number {
    const _splitFeeTx = new btc.Transaction();

    _splitFeeTx.from(feeUtxos);

    for (let i = 0; i < count; i++) {
      _splitFeeTx.addOutput(
        new btc.Transaction.Output({
          satoshis: 0,
          script: btc.Script.fromAddress(address),
        }),
      );
    }
    _splitFeeTx.feePerByte(feeRate);
    walletService.signTx(_splitFeeTx);
    return _splitFeeTx.vsize;
  }

  const vSize = calcVsize(walletService);

  const fee = vSize * feeRate;

  const satoshisPerOutput = Math.floor((splitFeeTx.inputAmount - fee) / count);

  for (let i = 0; i < count; i++) {
    splitFeeTx.addOutput(
      new btc.Transaction.Output({
        satoshis: satoshisPerOutput,
        script: btc.Script.fromAddress(address),
      }),
    );
  }
  walletService.signTx(splitFeeTx);

  //const txId = splitFeeTx.id;
  const txId = await broadcast(
    configService,
    walletService,
    splitFeeTx.uncheckedSerialize(),
  );
  if (txId instanceof Error) {
    throw txId;
  } else {
    log(`Spliting fee in txid: ${txId}`);
  }

  if (count > 1) {
    await waitTxConfirm(configService, txId, 1);
  }

  const newfeeUtxos: UTXO[] = [];

  for (let i = 0; i < count; i++) {
    newfeeUtxos.push({
      txId,
      outputIndex: i,
      script: splitFeeTx.outputs[i].script.toHex(),
      satoshis: splitFeeTx.outputs[i].satoshis,
    });
  }
  return newfeeUtxos;
}

export async function mergeTokens(
  configService: ConfigService,
  walletService: WalletService,
  spendService: SpendService,
  feeUtxos: UTXO[],
  feeRate: number,
  metadata: TokenMetadata,
  tokens: TokenContract[],
  changeAddress: btc.Address,
  cachedTxs: Map<string, btc.Transaction>,
): Promise<[TokenContract[], UTXO[], Error]> {
  const recipient = changeAddress;
  if (tokens.length < 4) {
    return [tokens, feeUtxos, null];
  }

  const nOneMerge = 37;

  const count = Math.ceil(tokens.length / nOneMerge);

  const splitedFeeUtxos = await feeSplitTx(
    configService,
    walletService,
    feeUtxos,
    feeRate,
    count,
  );

  const newFeeUtxos: UTXO[] = [];

  const newTokensTobeMerge: TokenContract[] = [];

  const txIdsWaitConfirm: {
    txId: string;
    nCount: number;
  }[] = [];
  for (let i = 0; i < count; i++) {
    const allPendingTxs: btc.Transaction[] = [];
    let newFeeUtxo: UTXO | null = splitedFeeUtxos[i];

    let newToken: TokenContract | null = null;

    const batchTokensTobeMerge: TokenContract[] = tokens.slice(
      i * nOneMerge,
      (i + 1) * nOneMerge,
    );
    for (let j = 0; j < 12; j++) {
      const tokensTobeMerge: TokenContract[] = batchTokensTobeMerge.slice(0, 4);

      if (tokensTobeMerge.length <= 1) {
        break;
      }
      const amountTobeMerge = calcTotalAmount(tokensTobeMerge);
      const result = await sendToken(
        configService,
        walletService,
        newFeeUtxo,
        feeRate,
        metadata,
        tokensTobeMerge,
        changeAddress,
        recipient,
        amountTobeMerge,
        cachedTxs,
      );

      if (result) {
        const { commitTx, revealTx } = result;
        cachedTxs.set(commitTx.id, commitTx);
        cachedTxs.set(revealTx.id, revealTx);
        allPendingTxs.push(commitTx);
        allPendingTxs.push(revealTx);

        const lastRevealTxOutputIndex = revealTx.outputs.length - 1;
        newFeeUtxo = {
          txId: revealTx.id,
          outputIndex: lastRevealTxOutputIndex,
          script: revealTx.outputs[lastRevealTxOutputIndex].script.toHex(),
          satoshis: revealTx.outputs[lastRevealTxOutputIndex].satoshis,
        };

        newToken = result.contracts[0];
        batchTokensTobeMerge.splice(0, 4, ...result.contracts);
      } else {
        return [tokens, feeUtxos, new Error('merge tokens failed!')];
      }
    }

    await broadcastMergeTokenTxs(
      configService,
      walletService,
      spendService,
      allPendingTxs,
    );

    if (newFeeUtxo) {
      newFeeUtxos.push(newFeeUtxo);
    }

    newTokensTobeMerge.push(newToken);

    if (count > 1 || (count === 1 && allPendingTxs.length > 20)) {
      txIdsWaitConfirm.push({
        txId: allPendingTxs[allPendingTxs.length - 1].id,
        nCount: allPendingTxs.length,
      });
    }
  }

  if (txIdsWaitConfirm.length > 1) {
    await Promise.all(
      txIdsWaitConfirm.map(async ({ txId, nCount }) => {
        await waitTxConfirm(configService, txId, nCount);
      }),
    );
  }

  return mergeTokens(
    configService,
    walletService,
    spendService,
    newFeeUtxos,
    feeRate,
    metadata,
    newTokensTobeMerge,
    changeAddress,
    cachedTxs,
  );
}

export async function waitTxConfirm(
  configService: ConfigService,
  txId: string,
  txCount: number,
) {
  if (txCount == 1) {
    console.log(`Waiting tx: ${txId} to be confirmed ...`);
  } else {
    console.log(
      `Waiting ${txCount} txs to be confirmed, the last txid is ${txId} ...`,
    );
  }

  while (true) {
    const info = await getConfirmations(configService, txId);

    if (info instanceof Error) {
      throw new Error(`getConfirmations failed, ${info.message}`);
    }

    if (info.confirmations >= 1) {
      break;
    }
    await sleep(3);
  }
}

export const MERGE_TOKEN_FAILED_ERR = 'broadcast merge token txs failed';

export function isMergeTxFail(e: Error) {
  return e.message.includes(MERGE_TOKEN_FAILED_ERR);
}

export async function broadcastMergeTokenTxs(
  configService: ConfigService,
  walletService: WalletService,
  spendService: SpendService,
  allPendingTxs: btc.Transaction[],
) {
  for (const tx of allPendingTxs) {
    const txId = await broadcast(
      configService,
      walletService,
      tx.uncheckedSerialize(),
    );

    if (txId instanceof Error) {
      throw new Error(`${MERGE_TOKEN_FAILED_ERR}, ${txId.message}`);
    }

    spendService.updateSpends(tx);
  }
}
