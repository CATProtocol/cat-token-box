import { ByteString, UTXO } from 'scrypt-ts';
import { Cat721NftInfo, NftParallelClosedMinterCat721Meta } from '../../../lib/metadata';
import { Signer } from '../../../lib/signer';
import { NftParallelClosedMinterCovenant } from '../../../covenants/nftParallelClosedMinterCovenant';
import { dummySig, getUnfinalizedTxId } from '../../../lib/utils';
import { Psbt } from 'bitcoinjs-lib';
import { Postage } from '../../../lib/constants';
import { ChainProvider, UtxoProvider } from '../../../lib/provider';
import { CatPsbt } from '../../../lib/catPsbt';

/**
 * Deploy a parallel-closed-mint CAT721 NFT minter.
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param ownerAddress the issuer address of the NFT minter
 * @param metadata the metadata of the CAT721 collection
 * @param feeRate the fee rate for constructing transactions
 * @param icon the icon of the CAT721 collection
 * @param changeAddress the address to receive change satoshis, use the signer address as the default
 * @returns the genesis transaction, the reveal transaction, the estimated genesis transaction vsize and the estimated reveal transaction vsize
 */
export async function deployParallelClosedMinter(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    ownerAddress: ByteString,
    metadata: NftParallelClosedMinterCat721Meta,
    feeRate: number,
    icon:
        | {
              type: string;
              body: string;
          }
        | undefined,
    changeAddress?: string,
): Promise<
    Cat721NftInfo<NftParallelClosedMinterCat721Meta> & {
        genesisTx: Psbt;
        revealTx: CatPsbt;
        estGenesisTxVSize: number;
        estRevealTxVSize: number;
    }
> {
    if (metadata.minterMd5 !== NftParallelClosedMinterCovenant.LOCKED_ASM_VERSION) {
        throw new Error('Invalid minterMd5 for OpenMinterV2Covenant');
    }

    const pubKey = await signer.getPublicKey();
    const address = await signer.getAddress();
    changeAddress = changeAddress || address;
    let sigRequests = [];

    const utxos = await utxoProvider.getUtxos(address);

    const { commitTxVSize, revealTxVSize } = estimateDeployTxVSizes(
        utxos,
        metadata,
        ownerAddress,
        address,
        pubKey,
        changeAddress,
        icon,
        feeRate,
    );

    const revealTxOutputAmount = Math.max(
        546,
        revealTxVSize * feeRate + Postage.MINTER_POSTAGE - Postage.METADATA_POSTAGE,
    );

    const { collectionId, collectionAddr, minterAddr, commitTxPsbt, revealPsbt } = buildCommitAndRevealTxs(
        metadata,
        ownerAddress,
        utxos,
        address,
        pubKey,
        changeAddress,
        feeRate,
        icon,
        revealTxOutputAmount,
    );

    sigRequests = [
        {
            psbtHex: commitTxPsbt.toHex(),
        },
        {
            psbtHex: revealPsbt.toHex(),
            options: revealPsbt.psbtOptions(),
        },
    ];

    // sign the psbts
    const [signedCommitPsbt, signedRevealPsbt] = await signer.signPsbts(sigRequests);

    // combine and finalize the signed psbts
    const genesisTx = Psbt.fromHex(signedCommitPsbt).finalizeAllInputs();
    const revealTx = await revealPsbt.combine(Psbt.fromHex(signedRevealPsbt)).finalizeAllInputsAsync();
    // broadcast the psbts
    await chainProvider.broadcast(genesisTx.extractTransaction().toHex());
    await chainProvider.broadcast(revealTx.extractTransaction().toHex());
    return {
        metadata,
        collectionId,
        collectionAddr,
        minterAddr,
        genesisTxid: genesisTx.extractTransaction().getId(),
        revealTxid: revealTx.extractTransaction().getId(),
        genesisTx,
        revealTx,
        estGenesisTxVSize: commitTxVSize,
        estRevealTxVSize: revealTxVSize,
    };
}

function estimateDeployTxVSizes(
    utxos: UTXO[],
    metadata: NftParallelClosedMinterCat721Meta,
    ownerAddress: ByteString,
    address: string,
    pubKey: string,
    changeAddress: string,
    icon:
        | {
              type: string;
              body: string;
          }
        | undefined,
    feeRate: number,
): {
    commitTxVSize: number;
    revealTxVSize: number;
} {
    const { commitTxPsbt: dummyCommitPsbt, revealPsbt: dummyRevealPsbt } = buildCommitAndRevealTxs(
        metadata,
        ownerAddress,
        utxos,
        address,
        pubKey,
        changeAddress,
        feeRate,
        icon,
        Postage.METADATA_POSTAGE,
    );

    dummySig(dummyCommitPsbt, changeAddress);

    return {
        commitTxVSize: dummyCommitPsbt.extractTransaction().virtualSize(),
        revealTxVSize: dummyRevealPsbt.estimateVSize(),
    };
}

function buildCommitAndRevealTxs(
    metadata: NftParallelClosedMinterCat721Meta,
    ownerAddress: ByteString,
    utxos: UTXO[],
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
    icon:
        | {
              type: string;
              body: string;
          }
        | undefined,
    revealTxOutputAmount: number,
) {
    // build the commit tx
    const { commitTxPsbt, commitScript } = NftParallelClosedMinterCovenant.buildCommitTx(
        metadata,
        address,
        pubKey,
        utxos,
        changeAddress,
        feeRate,
        icon,
        revealTxOutputAmount,
    );

    const commitTxid = getUnfinalizedTxId(commitTxPsbt);

    // build the reveal tx
    const { collectionId, collectionAddr, minterAddr, revealPsbt } = NftParallelClosedMinterCovenant.buildRevealTx(
        {
            txId: commitTxid,
            outputIndex: 0,
            script: Buffer.from(commitTxPsbt.txOutputs[0].script).toString('hex'),
            satoshis: Number(commitTxPsbt.txOutputs[0].value),
        },
        ownerAddress,
        metadata,
        commitScript,
        address,
        pubKey,
        [
            {
                txId: commitTxid,
                outputIndex: 1,
                script: Buffer.from(commitTxPsbt.txOutputs[1].script).toString('hex'),
                satoshis: Number(commitTxPsbt.txOutputs[1].value),
            },
        ],
    );

    return {
        collectionId,
        collectionAddr,
        minterAddr,
        commitTxPsbt,
        revealPsbt,
    };
}
