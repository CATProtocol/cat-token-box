import { UTXO } from 'scrypt-ts';
import { isP2TR, scriptToP2tr, toPsbt, toXOnly } from '../../../lib/utils';
import { getCatNFTCommitScript } from '../../../lib/commit';
import { Psbt } from 'bitcoinjs-lib';
import { Postage } from '../../../lib/constants';
import { btc } from '../../../lib/btc';

export function createNft(
    pubkey: string,
    address: string,
    feeRate: number,
    feeUtxos: UTXO[],
    contentType: string,
    contentBody: string,
    nftmetadata: object,
): {
    commitTxPsbt: Psbt;
    nftScript: Buffer;
    feeUTXO: UTXO;
    nftUTXO: UTXO;
} {
    const nftCommitScript = getCatNFTCommitScript(toXOnly(pubkey, isP2TR(address)), nftmetadata, {
        type: contentType,
        body: contentBody,
    });

    const nftScript = Buffer.from(nftCommitScript, 'hex');
    const { p2trLockingScript: p2tr } = scriptToP2tr(nftScript);

    const commitTx = new btc.Transaction()
        .from(feeUtxos)
        .addOutput(
            new btc.Transaction.Output({
                satoshis: Postage.NFT_POSTAGE,
                script: p2tr,
            }),
        )
        .feePerByte(feeRate)
        .change(address);

    if (commitTx.getChangeOutput() === null) {
        console.error('Insufficient satoshis balance!');
        return null;
    }
    commitTx.getChangeOutput().satoshis -= 1;

    const commitTxPsbt = toPsbt(commitTx);

    feeUtxos.forEach((utxo, index) => {
        commitTxPsbt.updateInput(index, {
            witnessUtxo: {
                script: Buffer.from(utxo.script, 'hex'),
                value: BigInt(utxo.satoshis),
            },
        });
    });

    return {
        commitTxPsbt,
        nftScript: nftScript,
        nftUTXO: {
            txId: commitTx.id,
            outputIndex: 0,
            satoshis: commitTx.outputs[0].satoshis,
            script: commitTx.outputs[0].script.toHex(),
        },
        feeUTXO: {
            txId: commitTx.id,
            outputIndex: 1,
            satoshis: commitTx.outputs[1].satoshis,
            script: commitTx.outputs[1].script.toHex(),
        },
    };
}
