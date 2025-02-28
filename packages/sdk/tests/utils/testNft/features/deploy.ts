import { UTXO } from 'scrypt-ts';
import { Psbt } from 'bitcoinjs-lib';
import {
    Cat721ClosedMinterUtxo,
    Cat721NftInfo,
    CatPsbt,
    ChainProvider,
    NftClosedMinterCat721Meta,
    Postage,
    Signer,
    UtxoProvider,
    bitcoinjs,
    dummySig,
    getDummyUtxo,
    getUnfinalizedTxId,
    markSpent,
} from '../../../../src/index';
import { NftClosedMinterCovenant } from '../nftClosedMinterCovenant';

/**
 * Deploy a CAT721 nft with metadata.
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
    metadata: NftClosedMinterCat721Meta,
    feeRate: number,
    changeAddress?: string,
): Promise<
    Cat721NftInfo<NftClosedMinterCat721Meta> & {
        genesisTx: bitcoinjs.Psbt;
        revealTx: CatPsbt;
        minterUtxo: Cat721ClosedMinterUtxo;
    }
> {
    const pubKey = await signer.getPublicKey();
    const address = await signer.getAddress();
    const feeAddress = await signer.getAddress();
    changeAddress = changeAddress || feeAddress;
    const { commitTxVSize, revealTxVSize } = estimateDeployTxVSizes(metadata, address, pubKey, changeAddress, feeRate);

    const commitTxOutputsAmount = revealTxVSize * feeRate + Postage.MINTER_POSTAGE;
    const commitTxFee = commitTxVSize * feeRate;
    const total = commitTxOutputsAmount + commitTxFee;
    const utxos = await utxoProvider.getUtxos(feeAddress, { total });

    const { collectionId, collectionAddr, minterAddr, commitPsbt, revealPsbt, minterUtxo } = buildCommitAndRevealTxs(
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
        collectionId,
        collectionAddr,
        minterAddr,
        genesisTxid: genesisTx.getId(),
        revealTxid: revealTx.getId(),
        genesisTx: genesisTxPsbt,
        revealTx: revealTxPsbt,
        metadata: metadata,
        minterUtxo,
    };
}

function estimateDeployTxVSizes(
    metadata: NftClosedMinterCat721Meta,
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
    metadata: NftClosedMinterCat721Meta,
    utxos: UTXO[],
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
    commitTxOutputsAmount: number,
) {
    // build the commit tx
    const commitPsbt = NftClosedMinterCovenant.buildCommitTx(
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
    const { collectionId, collectionAddr, minterAddr, revealPsbt, minterUtxo } = NftClosedMinterCovenant.buildRevealTx(
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
        collectionId,
        collectionAddr,
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
