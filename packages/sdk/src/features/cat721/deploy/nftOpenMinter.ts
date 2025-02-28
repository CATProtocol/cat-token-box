import { UTXO } from 'scrypt-ts';
import { Cat721NftInfo, NftOpenMinterCat721Meta } from '../../../lib/metadata';
import { Signer } from '../../../lib/signer';
import { NftOpenMinterCovenant } from '../../../covenants/nftOpenMinterCovenant';
import { dummySig, getDummyUtxo, getUnfinalizedTxId } from '../../../lib/utils';
import { Psbt } from 'bitcoinjs-lib';
import { Postage } from '../../../lib/constants';
import { bitcoinjs } from '../../../lib/btc';
import { ChainProvider, markSpent, UtxoProvider } from '../../../lib/provider';
import { CatPsbt } from '../../../lib/catPsbt';

export async function deploy(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    metadata: NftOpenMinterCat721Meta,
    initMerkleRoot: string,
    feeRate: number,
    changeAddress?: string,
): Promise<
    Cat721NftInfo<NftOpenMinterCat721Meta> & {
        genesisTx: bitcoinjs.Psbt;
        revealTx: CatPsbt;
        minter: NftOpenMinterCovenant;
    }
> {
    if (metadata.minterMd5 !== NftOpenMinterCovenant.LOCKED_ASM_VERSION) {
        throw new Error('Invalid minterMd5 for OpenMinterV2Covenant');
    }

    const pubKey = await signer.getPublicKey();
    const address = await signer.getAddress();
    const feeAddress = await signer.getAddress();
    changeAddress = changeAddress || feeAddress;
    let sigRequests = [];

    const { commitTxVSize, revealTxVSize } = estimateDeployTxVSizes(
        metadata,
        address,
        initMerkleRoot,
        pubKey,
        changeAddress,
        feeRate,
    );

    const commitTxOutputsAmount = revealTxVSize * feeRate + Postage.MINTER_POSTAGE;
    const commitTxFee = commitTxVSize * feeRate;
    const total = commitTxOutputsAmount + commitTxFee;
    const utxos = await utxoProvider.getUtxos(feeAddress, { total });

    const { collectionId, nftAddr, minterAddr, commitPsbt, revealPsbt, minter } = buildCommitAndRevealTxs(
        metadata,
        utxos,
        address,
        initMerkleRoot,
        pubKey,
        changeAddress,
        feeRate,
        commitTxOutputsAmount,
    );

    sigRequests = [
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
        collectionAddr: nftAddr,
        minterAddr,
        genesisTxid: genesisTx.getId(),
        revealTxid: revealTx.getId(),
        metadata,
        genesisTx: genesisTxPsbt,
        revealTx: revealTxPsbt,
        minter,
    };
}

function estimateDeployTxVSizes(
    metadata: NftOpenMinterCat721Meta,
    address: string,
    initMerkleRoot: string,
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
        initMerkleRoot,
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
    metadata: NftOpenMinterCat721Meta,
    utxos: UTXO[],
    address: string,
    initMerkleRoot: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
    commitTxOutputsAmount: number,
) {
    // build the commit tx
    const commitPsbt = NftOpenMinterCovenant.buildCommitTx(
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
    const { collectionId, nftAddr, minterAddr, revealPsbt, minter } = NftOpenMinterCovenant.buildRevealTx(
        {
            txId: commitTxid,
            outputIndex: 0,
            script: Buffer.from(commitPsbt.txOutputs[0].script).toString('hex'),
            satoshis: Number(commitPsbt.txOutputs[0].value),
        },
        metadata,
        initMerkleRoot,
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
        nftAddr,
        minterAddr,
        commitPsbt,
        revealPsbt,
        newFeeUtxo: {
            txId: commitTxid,
            outputIndex: 2,
            script: Buffer.from(commitPsbt.txOutputs[2].script).toString('hex'),
            satoshis: Number(commitPsbt.txOutputs[2].value),
        },
        minter,
    };
}
