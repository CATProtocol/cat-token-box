import { ChainProvider, ExtPsbt, markSpent, Signer, UTXO, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { Cat721NftInfo, ClosedMinterCat721Meta, dummySig, getDummyUtxo, Postage } from '../../../../src/index';
import { Psbt } from '@scrypt-inc/bitcoinjs-lib';
import { CAT721ClosedMinterCovenant } from '../cat721ClosedMinterCovenant';
import { CAT721ClosedMinterUtxo } from '../../testCAT721Generater';

export async function deploy(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    metadata: ClosedMinterCat721Meta,
    feeRate: number,
    changeAddress?: string,
): Promise<
    Cat721NftInfo<ClosedMinterCat721Meta> & {
        genesisTx: ExtPsbt;
        revealTx: ExtPsbt;
        minterUtxo: CAT721ClosedMinterUtxo;
    }
> {
    const pubKey = await signer.getPublicKey();
    const address = await signer.getAddress();
    const feeAddress = await signer.getAddress();
    changeAddress = changeAddress || feeAddress;
    const { revealTxVSize } = estimateDeployTxVSizes(metadata, address, pubKey, changeAddress, feeRate);

    const utxos = await utxoProvider.getUtxos(feeAddress);

    const commitTxOutputsAmount = revealTxVSize * feeRate + Postage.MINTER_POSTAGE;

    const { tokenId, tokenAddr, minterAddr, commitPsbt, revealPsbt, minterUtxo } = buildCommitAndRevealTxs(
        metadata,
        utxos,
        address,
        pubKey,
        changeAddress,
        feeRate,
        commitTxOutputsAmount,
    );

    const sigRequests = [
        {
            psbtHex: commitPsbt.toHex(),
            options: {
                autoFinalized: false,
                toSignInputs: utxos.map((value, index) => {
                    return { index: index, address: changeAddress };
                }),
            },
        },
        {
            psbtHex: revealPsbt.toHex(),
            options: revealPsbt.psbtOptions(),
        },
    ];
    // sign the psbts
    const [signedCommitPsbt, signedRevealPsbt] = await signer.signPsbts(sigRequests);

    // combine and finalize the signed psbts
    const genesisTxPsbt = await commitPsbt.combine(Psbt.fromHex(signedCommitPsbt)).finalizeAllInputs();
    const revealTxPsbt = await revealPsbt.combine(Psbt.fromHex(signedRevealPsbt)).finalizeAllInputs();
    // broadcast the psbts
    const genesisTx = genesisTxPsbt.extractTransaction();
    const revealTx = revealTxPsbt.extractTransaction();
    await chainProvider.broadcast(genesisTx.toHex());
    markSpent(utxoProvider, genesisTx);
    await chainProvider.broadcast(revealTx.toHex());
    markSpent(utxoProvider, revealTx);
    return {
        collectionId: tokenId,
        collectionAddr: tokenAddr,
        minterAddr,
        genesisTxid: genesisTx.getId(),
        revealTxid: revealTx.getId(),
        genesisTx: genesisTxPsbt,
        revealTx: revealTxPsbt,
        metadata: metadata,
        minterUtxo: minterUtxo,
    };
}

function estimateDeployTxVSizes(
    metadata: ClosedMinterCat721Meta,
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
): {
    commitTxVSize: number;
    revealTxVSize: number;
} {
    const { commitPsbt: dummyCommitPsbt, revealPsbt: dummyRevealPsbt } = buildCommitAndRevealTxs(
        metadata,
        [getDummyUtxo(changeAddress)],
        address,
        pubKey,
        changeAddress,
        feeRate,
        Postage.METADATA_POSTAGE,
    );

    dummySig(dummyCommitPsbt, changeAddress);

    return {
        commitTxVSize: dummyCommitPsbt.extractTransaction().virtualSize(),
        revealTxVSize: dummyRevealPsbt.estimateVSize(),
    };
}

function buildCommitAndRevealTxs(
    metadata: ClosedMinterCat721Meta,
    utxos: UTXO[],
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
    commitTxOutputsAmount: number,
) {
    // build the commit tx
    const commitPsbt = CAT721ClosedMinterCovenant.buildCommitTx(
        metadata,
        address,
        pubKey,
        utxos,
        commitTxOutputsAmount,
        changeAddress,
        feeRate,
    );

    const commitTxid = commitPsbt.unsignedTx.getId();

    // build the reveal tx
    const { tokenId, tokenAddr, minterAddr, revealPsbt, minterUtxo } = CAT721ClosedMinterCovenant.buildRevealTx(
        {
            txId: commitPsbt.unsignedTx.getId(),
            outputIndex: 0,
            script: Buffer.from(commitPsbt.txOutputs[0].script).toString('hex'),
            satoshis: Number(commitPsbt.txOutputs[0].value),
        },
        metadata,
        address,
        pubKey,
        [
            {
                address: address,
                txId: commitTxid,
                outputIndex: 1,
                script: Buffer.from(commitPsbt.txOutputs[1].script).toString('hex'),
                satoshis: Number(commitPsbt.txOutputs[1].value),
            },
        ],
    );

    return {
        tokenId,
        tokenAddr,
        minterAddr,
        commitPsbt,
        revealPsbt,
        newFeeUtxo: {
            txId: commitTxid,
            outputIndex: 2,
            script: Buffer.from(commitPsbt.txOutputs[2].script).toString('hex'),
            satoshis: Number(commitPsbt.txOutputs[2].value),
        },
        minterUtxo,
    };
}
