import { CatPsbt, DUST_LIMIT } from '../../../lib/catPsbt'
import { UTXO } from 'scrypt-ts'
import { Postage } from '../../../lib/constants'
import { Signer } from '../../../lib/signer'
import {
    getDummyUtxo,
    getDummyUtxos,
    isP2TR,
} from '../../../lib/utils'
import { UtxoProvider, ChainProvider, Cat721Utxo } from '../../../lib/provider'
import { Psbt } from 'bitcoinjs-lib'
import { MAX_INPUT } from '../../../contracts/utils/txUtil'
import {
    CAT721Covenant,
    TracedCat721Nft,
} from '../../../covenants/cat721Covenant'
import { CAT721GuardCovenant } from '../../../covenants/cat721GuardCovenant'
import { GuardType } from '../../../covenants/cat20GuardCovenant'
import { pickLargeFeeUtxo } from '../../cat20'

/**
 * Burn CAT721 NFTs in a single transaction, 
 * @param signer a signer, such as {@link DefaultSigner}  or {@link UnisatSigner} 
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param minterAddr the minter address of the CAT721 collection
 * @param inputNftUtxos CAT721 NFT utxos, which will all be burned
 * @param feeRate the fee rate for constructing transactions
 * @returns the guard transaction, the burn transaction, the estimated guard transaction vsize and the estimated burn transaction vsize
 */
export async function burnNft(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterAddr: string,
    inputNftUtxos: Cat721Utxo[],
    feeRate: number
): Promise<{
    guardTx: CatPsbt
    burnTx: CatPsbt
    estGuardTxVSize: number
    estSendTxVSize: number
}> {
    const pubkey = await signer.getPublicKey()
    const address = await signer.getAddress()
    const changeAddress = await signer.getAddress()

    const tracableNfts = await CAT721Covenant.backtrace(
        inputNftUtxos.map((utxo) => {
            return { ...utxo, minterAddr }
        }),
        chainProvider
    )

    const inputNfts = tracableNfts.map((nft) => nft.nft)

    const { guard, outputNfts } = CAT721Covenant.createBurnGuard(
        inputNfts.map((nft, i) => ({
            nft,
            inputIndex: i,
        }))
    )

    const { estGuardTxVSize, dummyGuardPsbt } = estimateGuardTxVSize(
        guard.bindToUtxo({ ...getDummyUtxo(changeAddress), script: undefined }),
        changeAddress
    )

    const estSendTxVSize = estimateSentTxVSize(
        tracableNfts,
        guard,
        dummyGuardPsbt,
        address,
        pubkey,
        outputNfts,
        changeAddress,
        feeRate
    )

    const total =
        feeRate * (estGuardTxVSize + estSendTxVSize) + Postage.TOKEN_POSTAGE

    const utxos = await utxoProvider.getUtxos(changeAddress, { total })


    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount')
    }

    const feeUtxo = pickLargeFeeUtxo(utxos)


    const guardPsbt = buildGuardTx(
        guard,
        feeUtxo,
        changeAddress,
        feeRate,
        estGuardTxVSize
    )

    const sendPsbt = buildBurnTx(
        tracableNfts,
        guard,
        guardPsbt,
        address,
        pubkey,
        outputNfts,
        changeAddress,
        feeRate,
        estSendTxVSize
    )

    // sign the psbts
    const [signedGuardPsbt, signedSendPsbt] = await signer.signPsbts([
        {
            psbtHex: guardPsbt.toHex(),
            options: guardPsbt.psbtOptions(),
        },
        {
            psbtHex: sendPsbt.toHex(),
            options: sendPsbt.psbtOptions(),
        },
    ])

    // combine and finalize the psbts
    const guardTx = await guardPsbt
        .combine(Psbt.fromHex(signedGuardPsbt))
        .finalizeAllInputsAsync()
    const sendTx = await sendPsbt
        .combine(Psbt.fromHex(signedSendPsbt))
        .finalizeAllInputsAsync()

    // broadcast the transactions
    await chainProvider.broadcast(guardTx.extractTransaction().toHex())
    await chainProvider.broadcast(sendTx.extractTransaction().toHex())

    return {
        guardTx,
        burnTx: sendTx,
        estGuardTxVSize,
        estSendTxVSize,
    }
}

function buildGuardTx(
    guard: CAT721GuardCovenant,
    feeUtxo: UTXO,
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {


    if (feeUtxo.satoshis < Postage.GUARD_POSTAGE + feeRate * (estimatedVSize || 1)) {
        throw new Error('Insufficient satoshis input amount')
    }

    const guardTx = new CatPsbt()
        .addFeeInputs([feeUtxo])
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .change(changeAddress, feeRate, estimatedVSize)

    guard.bindToUtxo(guardTx.getUtxo(1))

    return guardTx
}

function estimateGuardTxVSize(guard: CAT721GuardCovenant, changeAddress: string) {
    const dummyGuardPsbt = buildGuardTx(
        guard,
        getDummyUtxos(changeAddress, 1)[0],
        changeAddress,
        DUST_LIMIT
    )
    return {
        dummyGuardPsbt,
        estGuardTxVSize: dummyGuardPsbt.estimateVSize(),
    }
}

function buildBurnTx(
    tracableNfts: TracedCat721Nft[],
    guard: CAT721GuardCovenant,
    guardPsbt: CatPsbt,
    address: string,
    pubKey: string,
    outputNfts: (CAT721Covenant | undefined)[],
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    const inputNfts = tracableNfts.map((nft) => nft.nft)

    if (inputNfts.length + 2 > MAX_INPUT) {
        throw new Error(
            `Too many inputs that exceed the maximum input limit of ${MAX_INPUT}`
        )
    }

    const sendPsbt = new CatPsbt()

    // add outputs
    for (const outputNft of outputNfts) {
        if (outputNft) {
            sendPsbt.addCovenantOutput(outputNft, Postage.TOKEN_POSTAGE)
        }
    }

    // add nft inputs
    for (const inputNft of inputNfts) {
        sendPsbt.addCovenantInput(inputNft)
    }

    sendPsbt
        .addCovenantInput(guard, GuardType.Burn)
        .addFeeInputs([guardPsbt.getUtxo(2)])
        .change(changeAddress, feeRate, estimatedVSize)

    const inputCtxs = sendPsbt.calculateInputCtxs()
    const guardInputIndex = inputNfts.length
    // unlock nfts
    for (let i = 0; i < inputNfts.length; i++) {
        sendPsbt.updateCovenantInput(
            i,
            inputNfts[i],
            inputNfts[i].userSpend(
                i,
                inputCtxs,
                tracableNfts[i].trace,
                guard.getGuardInfo(guardInputIndex, guardPsbt.toTxHex()),
                isP2TR(address),
                pubKey
            )
        )
    }

    // unlock guard
    sendPsbt.updateCovenantInput(
        guardInputIndex,
        guard,
        guard.burn(guardInputIndex, inputCtxs, guardPsbt.toTxHex())
    )

    return sendPsbt
}

function estimateSentTxVSize(
    tracableNfts: TracedCat721Nft[],
    guard: CAT721GuardCovenant,
    guardPsbt: CatPsbt,
    address: string,
    pubKey: string,
    outputNfts: CAT721Covenant[],
    changeAddress: string,
    feeRate: number
) {
    return buildBurnTx(
        tracableNfts,
        guard,
        guardPsbt,
        address,
        pubKey,
        outputNfts,
        changeAddress,
        feeRate
    ).estimateVSize()
}
