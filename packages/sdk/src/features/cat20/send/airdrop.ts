import { ChainProvider, Int32, Signer, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { toTokenAddress } from '../../../lib/utils';
import { mergeCat20Utxo } from './merge';
import { pickFromStart } from './pick';
import { singleSend } from './singleSend';
import { waitTxConfirm } from './split';
import { CAT20Utxo } from '../../../lib/provider';

export interface AirdropProcess {
    onStart: () => void;
    onProcess: (receiver: { address: string; amount: Int32; txId: string }) => void;

    onSuccess: (
        success: Array<{
            address: string;
            amount: Int32;
            txId: string;
        }>,
    ) => void;

    onWaitTxConfirm: (txId: string) => void;
    onError: (err: Error) => void;
}

/**
 * Distribute CAT20 tokens to multiple recipient addresses across several transactions.
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param minterAddr the minter address of the CAT20 token
 * @param inputTokenUtxos CAT20 token utxos
 * @param receivers the list of recipient’s address and the token amount to that address
 * @param feeRate the fee rate for constructing transactions
 * @param cb a callback function for handling airdrop progress and errors
 * @returns all addresses and transaction IDs of successful airdrops
 */
export async function airdrop(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterAddr: string,
    inputTokenUtxos: CAT20Utxo[],
    receivers: Array<{
        address: string;
        amount: Int32;
    }>,
    feeRate: number,
    cb?: AirdropProcess,
): Promise<{
    cat20Utxos: CAT20Utxo[];
    success: Array<{
        address: string;
        amount: Int32;
        txId: string;
    }>;
}> {
    receivers.forEach((receiver) => {
        toTokenAddress(receiver.address);
    });

    const totalInputAmount = inputTokenUtxos.reduce((acc, inputTokenUtxo) => acc + inputTokenUtxo.state.amount, 0n);
    const totalOutputAmount = receivers.reduce((acc, receiver) => acc + receiver.amount, 0n);

    if (totalInputAmount < totalOutputAmount) {
        throw new Error(`Insufficient token balance, expect ${totalOutputAmount}`);
    }

    const nOneSplit = 3;

    const address = await signer.getAddress();

    const count = Math.ceil(receivers.length / nOneSplit);

    const success: Array<{
        address: string;
        amount: Int32;
        txId: string;
    }> = [];

    const airdropCat20Utxos: CAT20Utxo[] = [];
    let sendCount = 0;

    try {
        if (cb) {
            cb.onStart();
        }
        for (let i = 0; i < count; i++) {
            const pendings = receivers.slice(i * 3, (i + 1) * 3);

            const amount = pendings.reduce((acc, receiver) => acc + receiver.amount, 0n);

            let cat20Utxos = pickFromStart(inputTokenUtxos, amount);

            inputTokenUtxos = inputTokenUtxos.slice(cat20Utxos.length);

            if (cat20Utxos.length > 4) {
                const { cat20Utxos: newCat20Utxos } = await mergeCat20Utxo(
                    this.walletService,
                    utxoProvider,
                    chainProvider,
                    minterAddr,
                    cat20Utxos,
                    feeRate,
                );
                cat20Utxos = newCat20Utxos;
            }

            const result = await singleSend(
                signer,
                utxoProvider,
                chainProvider,
                minterAddr,
                cat20Utxos,
                pendings.map((receiver) => ({
                    address: toTokenAddress(receiver.address),
                    amount: receiver.amount,
                })),
                toTokenAddress(address),
                feeRate,
            );
            const txId = result.sendTxId;
            success.push(
                ...pendings.map((receiver) => ({
                    ...receiver,
                    txId,
                })),
            );

            if (cb) {
                pendings.forEach((receiver) => {
                    cb.onProcess({
                        ...receiver,
                        txId,
                    });
                });
            }

            const newCat20Utxos = result.newCAT20Utxos.slice(
                0,
                result.changeTokenOutputIndex > -1 ? result.newCAT20Utxos.length - 1 : result.newCAT20Utxos.length,
            );
            airdropCat20Utxos.push(...newCat20Utxos);
            if (result.changeTokenOutputIndex > -1) {
                const changeCat20Utxo = result.newCAT20Utxos[result.changeTokenOutputIndex - 1];
                inputTokenUtxos.push(changeCat20Utxo);
            }

            sendCount++;

            if (sendCount >= 12) {
                if (cb) {
                    cb.onWaitTxConfirm(txId);
                }

                await waitTxConfirm(chainProvider, txId, false);
                sendCount = 0;
            }
        }

        if (cb) {
            cb.onSuccess(success);
        }
    } catch (error) {
        if (cb) {
            cb.onError(error);
        }
    }

    return {
        cat20Utxos: airdropCat20Utxos,
        success,
    };
}
