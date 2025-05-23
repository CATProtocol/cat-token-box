import { Psbt } from '@scrypt-inc/bitcoinjs-lib';
import { ChainProvider, ExtPsbt, markSpent, Signer, UTXO, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20ClosedMinterCovenant } from '../../../covenants/index.js';
import { Postage, Cat20TokenInfo, ClosedMinterCat20Meta, dummySig, getDummyUtxo } from '../../../lib/index.js';

/**
 * Deploy a CAT20 token with ClosedMinter
 * @param signer a signer, such as {@link DefaultSigner}  or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param metadata the metadata of the CAT20 token
 * @param feeRate the fee rate for constructing transactions
 * @param changeAddress the address to receive change satoshis, use the signer address as the default
 * @returns the genesis transaction, the token reveal transaction and the premine transaction
 */
export async function deployClosedMinter(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    metadata: ClosedMinterCat20Meta,
    feeRate: number,
    changeAddress?: string,
): Promise<
    Cat20TokenInfo<ClosedMinterCat20Meta> & {
        genesisTx: ExtPsbt;
        revealTx: ExtPsbt;
    }
> {
    const pubKey = await signer.getPublicKey();
    const address = await signer.getAddress();
    changeAddress = changeAddress || address;
    let sigRequests = [];

    const { revealTxVSize } = estimateDeployTxVSizes(metadata, address, pubKey, changeAddress, feeRate);

    const commitTxOutputsAmount = revealTxVSize * feeRate + Postage.MINTER_POSTAGE;
    const utxos = await utxoProvider.getUtxos(address);

    const { tokenId, tokenAddr, minterAddr, commitPsbt, revealPsbt } = buildCommitAndRevealTxs(
        metadata,
        utxos,
        address,
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
    const genesisTxPsbt = commitPsbt.combine(Psbt.fromHex(signedCommitPsbt)).finalizeAllInputs();
    const revealTxPsbt = revealPsbt.combine(Psbt.fromHex(signedRevealPsbt)).finalizeAllInputs();

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
        metadata,
        genesisTx: genesisTxPsbt,
        revealTx: revealTxPsbt,
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
    const commitPsbt = CAT20ClosedMinterCovenant.buildCommitTx(
        metadata,
        address,
        pubKey,
        utxos,
        commitTxOutputsAmount,
        changeAddress,
        feeRate,
    );

    // build the reveal tx
    const { tokenId, tokenAddr, minterAddr, revealPsbt } = CAT20ClosedMinterCovenant.buildRevealTx(
        commitPsbt.getUtxo(0),
        metadata,
        address,
        pubKey,
        [commitPsbt.getUtxo(1)],
    );

    return {
        tokenId,
        tokenAddr,
        minterAddr,
        commitPsbt,
        revealPsbt,
        newFeeUtxo: commitPsbt.getUtxo(2),
    };
}