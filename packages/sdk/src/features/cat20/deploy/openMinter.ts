import { Psbt, Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { ChainProvider, ExtPsbt, markSpent, Signer, UTXO, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20OpenMinterCovenant } from '../../../covenants/cat20OpenMinterCovenant';
import { Postage } from '../../../lib/constants';
import { Cat20TokenInfo, OpenMinterCat20Meta } from '../../../lib/metadata';
import { addrToP2trLockingScript, dummySig, getDummyUtxo } from '../../../lib/utils';

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
export async function deploy(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    metadata: OpenMinterCat20Meta,
    feeRate: number,
    changeAddress?: string,
): Promise<
    Cat20TokenInfo<OpenMinterCat20Meta> & {
        genesisTx: ExtPsbt;
        revealTx: ExtPsbt;
        premineTx?: ExtPsbt;
    }
> {
    const pubKey = await signer.getPublicKey();
    const address = await signer.getAddress();
    changeAddress = changeAddress || address;
    let sigRequests = [];

    const { revealTxVSize } = estimateDeployTxVSizes(metadata, address, pubKey, changeAddress, feeRate);

    const commitTxOutputsAmount = revealTxVSize * feeRate + Postage.MINTER_POSTAGE;
    const utxos = await utxoProvider.getUtxos(address);

    const { tokenId, tokenAddr, minterAddr, commitPsbt, revealPsbt, newFeeUtxo } = buildCommitAndRevealTxs(
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

    // build the premine tx if applicable
    let preminePsbt: ExtPsbt | undefined;
    if (metadata.premine > 0n && metadata.preminerAddr) {
        preminePsbt = await buildPremineTx(
            newFeeUtxo,
            commitPsbt,
            revealPsbt,
            tokenId,
            tokenAddr,
            metadata,
            feeRate,
            changeAddress,
            address,
            pubKey,
        );

        sigRequests.push({
            psbtHex: preminePsbt.toHex(),
            options: preminePsbt.psbtOptions(),
        });
    }

    // sign the psbts
    const [signedCommitPsbt, signedRevealPsbt, signedPreminePsbt] = await signer.signPsbts(sigRequests);

    // combine and finalize the signed psbts
    const genesisTxPsbt = commitPsbt.combine(Psbt.fromHex(signedCommitPsbt)).finalizeAllInputs();
    const revealTxPsbt = revealPsbt.combine(Psbt.fromHex(signedRevealPsbt)).finalizeAllInputs();
    let premineTxPsbt: ExtPsbt | undefined;
    if (preminePsbt && signedPreminePsbt) {
        premineTxPsbt = preminePsbt.combine(Psbt.fromHex(signedPreminePsbt)).finalizeAllInputs();
    }

    // broadcast the psbts
    const genesisTx = genesisTxPsbt.extractTransaction();
    const revealTx = revealTxPsbt.extractTransaction();
    await chainProvider.broadcast(genesisTx.toHex());
    markSpent(utxoProvider, genesisTx);
    await chainProvider.broadcast(revealTx.toHex());
    markSpent(utxoProvider, revealTx);

    const premineTx = preminePsbt ? premineTxPsbt.extractTransaction() : undefined;
    if (premineTx) {
        await chainProvider.broadcast(premineTx.toHex());
        markSpent(utxoProvider, premineTx);
    }

    return {
        tokenId,
        tokenAddr,
        minterAddr,
        genesisTxid: genesisTx.getId(),
        revealTxid: revealTx.getId(),
        metadata,
        genesisTx: genesisTxPsbt,
        revealTx: revealTxPsbt,
        premineTx: premineTxPsbt,
        timestamp: new Date().getTime(),
    };
}

function estimateDeployTxVSizes(
    metadata: OpenMinterCat20Meta,
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
    metadata: OpenMinterCat20Meta,
    utxos: UTXO[],
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
    commitTxOutputsAmount: number,
) {
    // build the commit tx
    const commitPsbt = CAT20OpenMinterCovenant.buildCommitTx(
        metadata,
        address,
        pubKey,
        utxos,
        commitTxOutputsAmount,
        changeAddress,
        feeRate,
    );

    // build the reveal tx
    const { tokenId, tokenAddr, minterAddr, revealPsbt } = CAT20OpenMinterCovenant.buildRevealTx(
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

async function buildPremineTx(
    feeUtxo: UTXO,
    commitPsbt: ExtPsbt,
    revealPsbt: ExtPsbt,
    tokenId: string,
    tokenAddr: string,
    metadata: OpenMinterCat20Meta,
    feeRate: number,
    changeAddress: string,
    preminterAddress: string,
    preminterPubKey: string,
) {
    if (!metadata.preminerAddr) {
        throw new Error('preminer address is required for premine');
    }

    const tokenReceiver = metadata.preminerAddr;
    const minterPreTxHex = Transaction.fromBuffer(commitPsbt.data.getTransaction()).toHex();
    const spentMinterTx = Transaction.fromBuffer(revealPsbt.data.getTransaction());
    const spentMinterTxHex = spentMinterTx.toHex();

    const initialMinter = new CAT20OpenMinterCovenant(tokenId, metadata, {
        tokenScript: addrToP2trLockingScript(tokenAddr),
        hasMintedBefore: false,
        remainingCount: (metadata.max - metadata.premine) / metadata.limit,
    }).bindToUtxo(revealPsbt.getStatefulCovenantUtxo(1));


    return CAT20OpenMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        initialMinter,
        tokenReceiver,
        [feeUtxo],
        feeRate,
        changeAddress,
        preminterAddress,
        preminterPubKey,
    );
}
