import { CatPsbt, DUST_LIMIT } from '../../../lib/catPsbt'
import { UTXO } from 'scrypt-ts'
import { Postage } from '../../../lib/constants'
import { Signer } from '../../../lib/signer'
import {
    getDummyUtxo,
    getDummyUtxos,
    isP2TR,
} from '../../../lib/utils'
import { UtxoProvider, ChainProvider, Cat20Utxo } from '../../../lib/provider'
import { Psbt } from 'bitcoinjs-lib'
import { MAX_INPUT } from '../../../contracts/utils/txUtil'
import {
    CAT20Covenant,
    TracedCat20Token,
} from '../../../covenants/cat20Covenant'
import { Cat20GuardCovenant, GuardType } from '../../../covenants/cat20GuardCovenant'
import { pickLargeFeeUtxo } from '../send/pick'

/**
 * Burn CAT20 tokens in a single transaction.
 * @param signer a signer, such as {@link DefaultSigner}  or {@link UnisatSigner} 
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param minterAddr the minter address of a CAT20 token
 * @param inputTokenUtxos CAT20 token utxos, all of which are to be burned
 * @param feeRate the fee rate for constructing transactions
 * @returns the guard transaction, the burn transaction, the estimated guard transaction vsize and the estimated burn transaction vsize
 */
export async function burn(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterAddr: string,
    inputTokenUtxos: Cat20Utxo[],
    feeRate: number
): Promise<{
    guardTx: CatPsbt
    burnTx: CatPsbt
    estGuardTxVSize: number
    estSendTxVSize: number
}> {
    const pubkey = await signer.getPublicKey()
    const changeAddress = await signer.getAddress()

    const tracableTokens = await CAT20Covenant.backtrace(
        inputTokenUtxos.map((utxo) => {
            return { ...utxo, minterAddr }
        }),
        chainProvider
    )

    const inputTokens = tracableTokens.map((token) => token.token)

    const { guard, outputTokens } = CAT20Covenant.createBurnGuard(
        inputTokens.map((token, i) => ({
            token,
            inputIndex: i,
        }))
    )

    const { estGuardTxVSize, dummyGuardPsbt } = estimateGuardTxVSize(
        guard.bindToUtxo({ ...getDummyUtxo(changeAddress), script: undefined }),
        changeAddress
    )

    const estSendTxVSize = estimateSentTxVSize(
        tracableTokens,
        guard,
        dummyGuardPsbt,
        pubkey,
        outputTokens,
        changeAddress,
        feeRate
    )

    const total =
        feeRate * (estGuardTxVSize + estSendTxVSize) + Postage.TOKEN_POSTAGE // for a token change output

    const utxos = await utxoProvider.getUtxos(changeAddress, { total })

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount')
    }
    
    const guardPsbt = buildGuardTx(
        guard,
        pickLargeFeeUtxo(utxos),
        changeAddress,
        feeRate,
        estGuardTxVSize
    )

    const sendPsbt = buildBurnTx(
        tracableTokens,
        guard,
        guardPsbt,
        pubkey,
        outputTokens,
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
    guard: Cat20GuardCovenant,
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

function estimateGuardTxVSize(guard: Cat20GuardCovenant, changeAddress: string) {
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
    tracableTokens: TracedCat20Token[],
    guard: Cat20GuardCovenant,
    guardPsbt: CatPsbt,
    pubKey: string,
    outputTokens: (CAT20Covenant | undefined)[],
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    const inputTokens = tracableTokens.map((token) => token.token)

    if (inputTokens.length + 2 > MAX_INPUT) {
        throw new Error(
            `Too many inputs that exceed the maximum input limit of ${MAX_INPUT}`
        )
    }

    const sendPsbt = new CatPsbt()

    // add token outputs
    for (const outputToken of outputTokens) {
        if (outputToken) {
            sendPsbt.addCovenantOutput(outputToken, Postage.TOKEN_POSTAGE)
        }
    }

    // add token inputs
    for (const inputToken of inputTokens) {
        sendPsbt.addCovenantInput(inputToken)
    }

    sendPsbt
        .addCovenantInput(guard, GuardType.Burn)
        .addFeeInputs([guardPsbt.getUtxo(2)])
        .change(changeAddress, feeRate, estimatedVSize)

    const inputCtxs = sendPsbt.calculateInputCtxs()
    const guardInputIndex = inputTokens.length

    // unlock tokens
    for (let i = 0; i < inputTokens.length; i++) {
        sendPsbt.updateCovenantInput(
            i,
            inputTokens[i],
            inputTokens[i].userSpend(
                i,
                inputCtxs,
                tracableTokens[i].trace,
                guard.getGuardInfo(guardInputIndex, guardPsbt.toTxHex()),
                isP2TR(changeAddress),
                pubKey,
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
    tracableTokens: TracedCat20Token[],
    guard: Cat20GuardCovenant,
    guardPsbt: CatPsbt,
    pubKey: string,
    outputTokens: CAT20Covenant[],
    changeAddress: string,
    feeRate: number
) {
    return buildBurnTx(
        tracableTokens,
        guard,
        guardPsbt,
        pubKey,
        outputTokens,
        changeAddress,
        feeRate
    ).estimateVSize()
}
