import { ProtocolState } from '../../../lib/state'
import { NftParallelClosedMinterCovenant } from '../../../covenants/nftParallelClosedMinterCovenant'
import { CatPsbt } from '../../../lib/catPsbt'
import { NftParallelClosedMinterCat721Meta } from '../../../lib/metadata'
import { ByteString, Ripemd160 } from 'scrypt-ts'
import { Signer } from '../../../lib/signer'
import { UtxoProvider, ChainProvider, Cat721MinterUtxo } from '../../../lib/provider'
import { Psbt, Transaction } from 'bitcoinjs-lib'
import { createNft } from './nft'


/**
 * Mint a CAT721 NFT in a single transaction.
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner} 
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param ownerAddress the issuer address of the nft minter
 * @param cat721MinterUtxo an UTXO that contains the minter of the cat721 nft
 * @param collectionId the id of the CAT721 nft collection
 * @param metadata the metadata of the CAT721 collection
 * @param nftReceiver the recipient's address of the newly minted nft
 * @param feeRate the fee rate for constructing transactions
 * @param contentType the content type of the newly minted nft
 * @param contentBody the content body of the newly minted nft
 * @param nftMetadata the metadata of the newly minted nft
 * @returns the nft commit transaction, the mint transaction, and the estimated mint transaction vsize
 */
export async function mintNft(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    ownerAddress: ByteString,
    cat721MinterUtxo: Cat721MinterUtxo,
    collectionId: string,
    metadata: NftParallelClosedMinterCat721Meta,
    nftReceiver: Ripemd160,
    feeRate: number,
    contentType: string,
    contentBody: string,
    nftMetadata: object,
): Promise<{
    mintTx: CatPsbt;
    nftTx: Psbt;
    estMintTxVSize: number;
}> {
    const address = await signer.getAddress()
    const pubKey = await signer.getPublicKey()

    const minter = new NftParallelClosedMinterCovenant(
        ownerAddress,
        collectionId,
        metadata,
        cat721MinterUtxo.state,
    ).bindToUtxo(cat721MinterUtxo.utxo)

    // fetch minter preTx
    const minterInputIndex = 0
    const spentMinterTxHex = await chainProvider.getRawTransaction(cat721MinterUtxo.utxo.txId);
    const spentMinterTx = Transaction.fromHex(spentMinterTxHex)
    const minterPreTxHex = await chainProvider.getRawTransaction(
        Buffer.from(
            spentMinterTx.ins[minterInputIndex].hash.reverse()
        ).toString('hex')
    )

    const utxos = await utxoProvider.getUtxos(address, { maxCnt: 5 })

    const {feeUTXO, nftScript, nftUTXO, commitTxPsbt} = createNft(pubKey, address, feeRate, utxos, contentType, contentBody, nftMetadata);

    const estimatedVSize = NftParallelClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(cat721MinterUtxo.txoStateHashes),
        minter,
        pubKey,
        nftReceiver,
        nftUTXO,
        nftScript,
        [feeUTXO],
        feeRate,
        address,
        undefined
    ).estimateVSize()

    const mintPsbt = NftParallelClosedMinterCovenant.buildMintTx(
        minterPreTxHex,
        spentMinterTxHex,
        ProtocolState.fromStateHashList(cat721MinterUtxo.txoStateHashes),
        minter,
        pubKey,
        nftReceiver,
        nftUTXO,
        nftScript,
        [feeUTXO],
        feeRate,
        address,
        estimatedVSize
    )

    const [signedCommitPsbt, signedMintPsbt]  = await signer.signPsbts([
        {
            psbtHex: commitTxPsbt.toHex(),
        },
        {
            psbtHex: mintPsbt.toHex(),
            options: mintPsbt.psbtOptions()
        }
    ])

    const nftPsbt = Psbt.fromHex(signedCommitPsbt).finalizeAllInputs()

    await mintPsbt
        .combine(Psbt.fromHex(signedMintPsbt))
        .finalizeAllInputsAsync()

    await chainProvider.broadcast(nftPsbt.extractTransaction().toHex())

    await chainProvider.broadcast(mintPsbt.extractTransaction().toHex())

    return {
        nftTx: nftPsbt,
        mintTx: mintPsbt,
        estMintTxVSize: estimatedVSize,
    }
}
