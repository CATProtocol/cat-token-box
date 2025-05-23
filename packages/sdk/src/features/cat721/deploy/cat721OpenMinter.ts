import { ChainProvider, ExtPsbt, hash160, Signer, UTXO, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { CAT721OpenMinterCovenant } from '../../../covenants/index.js';
import { Postage, Cat721NftInfo, OpenMinterCat721Meta, dummySig, getDummyUtxo, processExtPsbts } from '../../../lib/index.js';

/**
 * Deploy a CAT20 token with metadata and automatically mint the pre-mined tokens, if applicable.
 * @param signer a signer, such as {@link DefaultSigner}  or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param metadata the metadata of the CAT20 token
 * @param feeRate the fee rate for constructing transactions
 * @param changeAddress the address to receive change satoshis, use the signer address as the default
 * @returns the genesis transaction, the token reveal transaction and the premine transaction
 */
export async function deployNft(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    metadata: OpenMinterCat721Meta,
    initMerkleRoot: string,
    feeRate: number,
    changeAddress?: string,
): Promise<
    Cat721NftInfo<OpenMinterCat721Meta> & {
        genesisTx: ExtPsbt;
        revealTx: ExtPsbt;
        minter: CAT721OpenMinterCovenant;
    }
> {
    const pubKey = await signer.getPublicKey();
    const address = await signer.getAddress();
    const feeAddress = await signer.getAddress();
    changeAddress = changeAddress || feeAddress;

    const { revealTxVSize } = estimateDeployTxVSizes(metadata, address, pubKey, changeAddress, feeRate);

    const commitTxOutputsAmount = revealTxVSize * feeRate + Postage.MINTER_POSTAGE;
    const utxos = await utxoProvider.getUtxos(feeAddress);

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

    const {
        psbts: [genesisTxPsbt, revealTxPsbt],
    } = await processExtPsbts(signer, utxoProvider, chainProvider, [commitPsbt, revealPsbt]);

    return {
        collectionId,
        collectionAddr: nftAddr,
        minterAddr,
        genesisTxid: genesisTxPsbt.unsignedTx.getId(),
        revealTxid: revealTxPsbt.unsignedTx.getId(),
        metadata,
        genesisTx: genesisTxPsbt,
        revealTx: revealTxPsbt,
        minter,
    };
}

function estimateDeployTxVSizes(
    metadata: OpenMinterCat721Meta,
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
        hash160(''),
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
    metadata: OpenMinterCat721Meta,
    utxos: UTXO[],
    address: string,
    initMerkleRoot: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
    commitTxOutputsAmount: number,
) {
    // build the commit tx
    const commitPsbt = CAT721OpenMinterCovenant.buildCommitTx(
        metadata,
        address,
        pubKey,
        utxos,
        commitTxOutputsAmount,
        changeAddress,
        feeRate,
    );

    // build the reveal tx
    const { collectionId, nftAddr, minterAddr, revealPsbt, minter } = CAT721OpenMinterCovenant.buildRevealTx(
        commitPsbt.getUtxo(0),
        metadata,
        initMerkleRoot,
        address,
        pubKey,
        [commitPsbt.getUtxo(1)],
    );

    return {
        collectionId,
        nftAddr,
        minterAddr,
        commitPsbt,
        revealPsbt,
        newFeeUtxo: commitPsbt.getUtxo(2),
        minter,
    };
}
