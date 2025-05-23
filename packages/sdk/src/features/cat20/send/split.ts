import { ChainProvider, markSpent, Signer, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { Psbt } from '@scrypt-inc/bitcoinjs-lib';
import { dummySig, sleep } from '../../../lib/index.js';


/**
 * Split all UTXOs of the current signer into count equal UTXOs.
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param utxoProvider  a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param feeRate the fee rate for constructing transactions
 * @param count split into count equal UTXOs.
 * @returns
 */
export async function feeSplitTx(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    feeRate: number,
    count: number,
): Promise<void> {
    const address = await signer.getAddress();
    const feeUtxos = await utxoProvider.getUtxos(address);
    if (count === 1) {
        return;
    }

    const splitTxPsbt = new Psbt();

    for (const utxo of feeUtxos) {
        splitTxPsbt.addInput({
            hash: utxo.txId,
            index: utxo.outputIndex,
            witnessUtxo: {
                script: Buffer.from(utxo.script, 'hex'),
                value: BigInt(utxo.satoshis),
            },
        });
    }

    function calcVsize(address: string): number {
        const splitTxPsbt = new Psbt();

        for (const utxo of feeUtxos) {
            splitTxPsbt.addInput({
                hash: utxo.txId,
                index: utxo.outputIndex,
                witnessUtxo: {
                    script: Buffer.from(utxo.script, 'hex'),
                    value: BigInt(utxo.satoshis),
                },
            });
        }

        for (let i = 0; i < count; i++) {
            splitTxPsbt.addOutput({
                value: 0n,
                address: address,
            });
        }

        dummySig(splitTxPsbt, address);

        return splitTxPsbt.extractTransaction(true).virtualSize();
    }

    const vSize = calcVsize(address);

    const fee = vSize * feeRate;

    const inputAmount = splitTxPsbt.data.inputs.reduce((total, input) => total + Number(input.witnessUtxo!.value), 0);

    const satoshisPerOutput = Math.floor((inputAmount - fee) / count);

    for (let i = 0; i < count; i++) {
        splitTxPsbt.addOutput({
            value: BigInt(satoshisPerOutput),
            address: address,
        });
    }

    const signedSplitTxPsbt = await signer.signPsbt(splitTxPsbt.toHex());

    const splitFeeTx = Psbt.fromHex(signedSplitTxPsbt).finalizeAllInputs().extractTransaction();

    await chainProvider.broadcast(splitFeeTx.toHex());

    markSpent(utxoProvider, splitFeeTx);

    const txId = splitFeeTx.getId();
    for (let i = 0; i < splitFeeTx.outs.length; i++) {
        const out = splitFeeTx.outs[i];
        utxoProvider.addNewUTXO({
            txId,
            outputIndex: i,
            script: Buffer.from(out.script).toString('hex'),
            satoshis: Number(out.value),
        });
    }

    console.log(`Spliting fee in txid: ${txId}`);
    if (count > 1) {
        await waitTxConfirm(chainProvider, txId);
    }
}

/**
 * Waiting for transaction confirmation.
 * @param chainProvider a  {@link ChainProvider}
 * @param txId transaction ID
 * @param log if print log
 */
export async function waitTxConfirm(chainProvider: ChainProvider, txId: string, log: boolean = true) {
    if (log) {
        console.log(`Waiting tx: ${txId} to be confirmed ...`);
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const confirmations = await chainProvider.getConfirmations(txId);

        if (confirmations >= 1) {
            break;
        }
        await sleep(3);
    }
}
