import { UTXO } from 'scrypt-ts';
import { Psbt } from 'bitcoinjs-lib';
import {
    Cat20TokenInfo,
    CatPsbt,
    ChainProvider,
    ClosedMinterCat20Meta,
    Postage,
    Signer,
    UtxoProvider,
    bitcoinjs,
    dummySig,
    getDummyUtxo,
    getUnfinalizedTxId,
    markSpent,
} from '../../../../src/index';
import { ClosedMinterCovenant } from '../closedMinterCovenant';

/**
 * Deploy a CAT20 token with metadata.
 * @param signer a signer, such as {@link DefaultSigner}  or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param metadata the metadata of the CAT20 token
 * @param feeRate the fee rate for constructing transactions
 * @param changeAddress the address to receive change satoshis, use the signer address as the default
 * @returns the genesis transaction, the token reveal transaction and the premine transaction
 */
export async function deploy(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    metadata: ClosedMinterCat20Meta,
    feeRate: number,
    changeAddress?: string,
): Promise<
    Cat20TokenInfo<ClosedMinterCat20Meta> & {
        genesisTx: bitcoinjs.Psbt;
        revealTx: CatPsbt;
    }
> {
    // if (metadata.minterMd5 !== ClosedMinterCovenant.LOCKED_ASM_VERSION) {
    //     throw new Error('Invalid minterMd5 for ClosedMinterCovenant');
    // }

    const pubKey = await signer.getPublicKey();
    const address = await signer.getAddress();
    const feeAddress = await signer.getAddress();
    changeAddress = changeAddress || feeAddress;
    const { commitTxVSize, revealTxVSize } = estimateDeployTxVSizes(metadata, address, pubKey, changeAddress, feeRate);

    const commitTxOutputsAmount = revealTxVSize * feeRate + Postage.MINTER_POSTAGE;
    const commitTxFee = commitTxVSize * feeRate;
    const total = commitTxOutputsAmount + commitTxFee;
    const utxos = await utxoProvider.getUtxos(feeAddress, { total });

    const { tokenId, tokenAddr, minterAddr, commitPsbt, revealPsbt } = buildCommitAndRevealTxs(
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
    const genesisTxPsbt = Psbt.fromHex(signedCommitPsbt).finalizeAllInputs();
    const revealTxPsbt = await revealPsbt.combine(Psbt.fromHex(signedRevealPsbt)).finalizeAllInputsAsync();
    // broadcast the psbts
    const genesisTx = genesisTxPsbt.extractTransaction();
    const revealTx = revealTxPsbt.extractTransaction();
    await chainProvider.broadcast(genesisTx.toHex());
    markSpent(utxoProvider, genesisTx);
    await chainProvider.broadcast(revealTx.toHex());
    markSpent(utxoProvider, revealTx);

    return {
        tokenId,
        tokenAddr,
        minterAddr,
        genesisTxid: genesisTx.getId(),
        revealTxid: revealTx.getId(),
        genesisTx: genesisTxPsbt,
        revealTx: revealTxPsbt,
        metadata: metadata,
        timestamp: new Date().getTime(),
    };
}

function estimateDeployTxVSizes(
    metadata: ClosedMinterCat20Meta,
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
    metadata: ClosedMinterCat20Meta,
    utxos: UTXO[],
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
    commitTxOutputsAmount: number,
) {
    // build the commit tx
    const commitPsbt = ClosedMinterCovenant.buildCommitTx(
        metadata,
        address,
        pubKey,
        utxos,
        commitTxOutputsAmount,
        changeAddress,
        feeRate,
    );

    const commitTxid = getUnfinalizedTxId(commitPsbt);

    // build the reveal tx
    const { tokenId, tokenAddr, minterAddr, revealPsbt } = ClosedMinterCovenant.buildRevealTx(
        {
            txId: commitTxid,
            outputIndex: 0,
            script: Buffer.from(commitPsbt.txOutputs[0].script).toString('hex'),
            satoshis: Number(commitPsbt.txOutputs[0].value),
        },
        metadata,
        address,
        pubKey,
        [
            {
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
    };
}
