import { Cat20Utxo, ChainProvider, UtxoProvider } from '../../../lib/provider';
import { Signer } from '../../../lib/signer';
import { toTokenAddress } from '../../../lib/utils';
import { singleSend } from './singleSend';
import { feeSplitTx, waitTxConfirm } from './split';
import { calcTotalAmount } from './pick';


/**
 * Consolidate all CAT20 tokens into a single UTXO through multiple transactions.
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner} 
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param minterAddr the minter address of the CAT20 token
 * @param inputTokenUtxos CAT20 token utxos to be merged
 * @param feeRate the fee rate for constructing transactions
 * @returns the CAT20 UTXO that combines all CAT20 inputs
 */
export async function mergeCat20Utxo(
  signer: Signer,
  utxoProvider: UtxoProvider,
  chainProvider: ChainProvider,
  minterAddr: string,
  inputTokenUtxos: Cat20Utxo[],
  feeRate: number,
): Promise<{
  cat20Utxos: Cat20Utxo[],
}> {

  if (inputTokenUtxos.length < 2) {
    return {
      cat20Utxos: inputTokenUtxos,
    }
  }

  const address = await signer.getAddress();

  const recipient =  toTokenAddress(address);

  const nOneMerge = 37;

  const count = Math.ceil(inputTokenUtxos.length / nOneMerge);

  await feeSplitTx(
    signer,
    utxoProvider,
    chainProvider,
    feeRate,
    count,
  );

  const newTokensTobeMerge: Cat20Utxo[] = [];

  const txIdsWaitConfirm: string[] = [];

  await Promise.all(new Array(count).fill(0).map(async (_, i) => {

    let newToken: Cat20Utxo | null = null;
    const batchTokensTobeMerge: Cat20Utxo[] = inputTokenUtxos.slice(
      i * nOneMerge,
      (i + 1) * nOneMerge,
    );
    for (let j = 0; j < 12; j++) {
      const tokensTobeMerge: Cat20Utxo[] = batchTokensTobeMerge.slice(0, 4);

      if(tokensTobeMerge.length === 1) {
        break;
      }

      const amountTobeMerge = calcTotalAmount(tokensTobeMerge);
      const result = await singleSend(
        signer,
        utxoProvider,
        chainProvider,
        minterAddr,
        tokensTobeMerge,
        [
          {
            address: recipient,
            amount: amountTobeMerge,
          }
        ],
        recipient,
        feeRate,
      );

      newToken = result.newCat20Utxos[0];
      batchTokensTobeMerge.splice(0, 4, newToken);
    }

    newTokensTobeMerge.push(newToken);
    if (count > 1) {
      txIdsWaitConfirm.push(newToken.utxo.txId);
    }
  }))

  if (txIdsWaitConfirm.length > 1) {
    await Promise.all(
      txIdsWaitConfirm.map(async (txId) => {
        await waitTxConfirm(chainProvider, txId);
      }),
    );
  }

  return mergeCat20Utxo(
    signer,
    utxoProvider,
    chainProvider,
    minterAddr,
    newTokensTobeMerge,
    feeRate,
  );
}