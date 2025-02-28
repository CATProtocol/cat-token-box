import { CatPsbt, DUST_LIMIT, InputContext } from '../../../lib/catPsbt';
import { Ripemd160, UTXO, fill, hash160, toByteString } from 'scrypt-ts';
import { Postage } from '../../../lib/constants';
import { Signer } from '../../../lib/signer';
import { getDummyUtxo, getDummyUtxos } from '../../../lib/utils';
import { UtxoProvider, ChainProvider, Cat20Utxo, markSpent } from '../../../lib/provider';
import { Psbt } from 'bitcoinjs-lib';
import { CAT20Covenant, TracedCat20Token } from '../../../covenants/cat20Covenant';
import { Cat20GuardCovenant } from '../../../covenants/cat20GuardCovenant';
import { pickLargeFeeUtxo } from './pick';
import { CAT20Proto } from '../../../contracts/token/cat20Proto';
import { createInputStateProofArray, txHexToXrayedTxIdPreimg4 } from '../../../lib/proof';
import { int32 } from '../../../contracts/types';
import { TX_INPUT_COUNT_MAX } from '../../../contracts/constants';

/**
 * Send CAT20 tokens to the list of recipients.
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param minterAddr the minter address of the CAT20 token
 * @param inputTokenUtxos CAT20 token utxos to be sent
 * @param receivers the recipient's address and token amount
 * @param tokenChangeAddress the address to receive change CAT20 tokens
 * @param feeRate the fee rate for constructing transactions
 * @returns the guard transaction, the send transaction and the CAT20 token outputs
 */
export async function contractSend(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterAddr: string,
    inputTokenUtxos: Cat20Utxo[],
    receivers: Array<{
        address: Ripemd160;
        amount: int32;
    }>,
    tokenChangeAddress: Ripemd160,
    feeRate: number,
): Promise<{
    guardTx: CatPsbt;
    sendTx: CatPsbt;
    sendTxId: string;
    guardTxId: string;
    newCat20Utxos: Cat20Utxo[];
    changeTokenOutputIndex: number;
}> {
    const changeAddress = await signer.getAddress();

    const tracableTokens = await CAT20Covenant.backtrace(
        inputTokenUtxos.map((utxo) => {
            return { ...utxo, minterAddr };
        }),
        chainProvider,
    );

    const inputTokens = tracableTokens.map((token) => token.token);

    const { guard, outputTokens, changeTokenOutputIndex } = CAT20Covenant.createTransferGuard(
        inputTokens.map((token, i) => ({
            token,
            inputIndex: i,
        })),
        receivers.map((receiver, index) => ({
            ...receiver,
            outputIndex: index + 1,
        })),
        {
            address: tokenChangeAddress,
        },
    );

    const { estGuardTxVSize, dummyGuardPsbt } = estimateGuardTxVSize(
        guard.bindToUtxo({ ...getDummyUtxo(changeAddress), script: undefined }),
        changeAddress,
    );

    const estSendTxVSize = estimateSentTxVSize(
        tracableTokens,
        guard,
        dummyGuardPsbt,
        outputTokens,
        changeAddress,
        feeRate,
    );

    const total = feeRate * (estGuardTxVSize + estSendTxVSize) + Postage.TOKEN_POSTAGE; // for a token change output

    const utxos = await utxoProvider.getUtxos(changeAddress, { total });

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount');
    }

    const feeUtxo = pickLargeFeeUtxo(utxos);

    const guardPsbt = buildGuardTx(guard, feeUtxo, changeAddress, feeRate, estGuardTxVSize);

    const sendPsbt = buildSendTx(
        tracableTokens,
        guard,
        guardPsbt,
        outputTokens,
        changeAddress,
        feeRate,
        estSendTxVSize,
    );

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
    ]);

    // combine and finalize the psbts
    const guardTxPsbt = await guardPsbt.combine(Psbt.fromHex(signedGuardPsbt)).finalizeAllInputsAsync();
    const sendTxPsbt = await sendPsbt.combine(Psbt.fromHex(signedSendPsbt)).finalizeAllInputsAsync();
    const guardTx = guardTxPsbt.extractTransaction();
    const sendTx = sendTxPsbt.extractTransaction();
    // broadcast the transactions
    await chainProvider.broadcast(guardTx.toHex());
    markSpent(utxoProvider, guardTx);
    await chainProvider.broadcast(sendTx.toHex());
    markSpent(utxoProvider, sendTx);

    const txStatesInfo = sendPsbt.getTxStatesInfo();
    const newCat20Utxos: Cat20Utxo[] = outputTokens
        .filter((outputToken) => typeof outputToken !== 'undefined')
        .map((covenant, index) => ({
            utxo: {
                txId: sendTx.getId(),
                outputIndex: index + 1,
                script: Buffer.from(sendTx.outs[index + 1].script).toString('hex'),
                satoshis: Number(sendTx.outs[index + 1].value),
            },
            txoStateHashes: txStatesInfo.stateHashes,
            state: covenant.state,
        }));

    const newFeeUtxo = sendPsbt.getChangeUTXO();

    utxoProvider.addNewUTXO(newFeeUtxo);

    return {
        sendTxId: sendTx.getId(),
        guardTxId: guardTx.getId(),
        guardTx: guardTxPsbt,
        sendTx: sendPsbt,
        newCat20Utxos,
        changeTokenOutputIndex,
    };
}

function buildGuardTx(
    guard: Cat20GuardCovenant,
    feeUtxo: UTXO,
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number,
) {
    if (feeUtxo.satoshis < Postage.GUARD_POSTAGE + feeRate * (estimatedVSize || 1)) {
        throw new Error('Insufficient satoshis input amount');
    }

    const guardTx = new CatPsbt()
        .addFeeInputs([feeUtxo])
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .change(changeAddress, feeRate, estimatedVSize);

    guard.bindToUtxo(guardTx.getUtxo(1));

    return guardTx;
}

function estimateGuardTxVSize(guard: Cat20GuardCovenant, changeAddress: string) {
    const dummyGuardPsbt = buildGuardTx(guard, getDummyUtxos(changeAddress, 1)[0], changeAddress, DUST_LIMIT);
    return {
        dummyGuardPsbt,
        estGuardTxVSize: dummyGuardPsbt.estimateVSize(),
    };
}

function buildSendTx(
    tracableTokens: TracedCat20Token[],
    guard: Cat20GuardCovenant,
    guardPsbt: CatPsbt,
    outputTokens: (CAT20Covenant | undefined)[],
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number,
) {
    const inputTokens = tracableTokens.map((token) => token.token);

    if (inputTokens.length + 2 > TX_INPUT_COUNT_MAX) {
        throw new Error(`Too many inputs that exceed the maximum input limit of ${TX_INPUT_COUNT_MAX}`);
    }

    const sendPsbt = new CatPsbt();

    // add token outputs
    for (const outputToken of outputTokens) {
        if (outputToken) {
            sendPsbt.addCovenantOutput(outputToken, Postage.TOKEN_POSTAGE);
        }
    }

    // add token inputs
    for (const inputToken of inputTokens) {
        sendPsbt.addCovenantInput(inputToken);
    }

    sendPsbt
        .addCovenantInput(guard)
        .addFeeInputs([guardPsbt.getUtxo(2)])
        .change(changeAddress, feeRate, estimatedVSize);

    const inputCtxs = sendPsbt.calculateInputCtxs();
    const guardInputIndex = inputTokens.length;
    // unlock tokens
    for (let i = 0; i < inputTokens.length; i++) {
        const ctx: InputContext = inputCtxs.get(i);
        const { spentScriptsCtx } = ctx;
        const index = spentScriptsCtx
            .map((value) => toByteString(hash160(value)))
            .indexOf(inputTokens[i].state.ownerAddr);
        sendPsbt.updateCovenantInput(
            i,
            inputTokens[i],
            inputTokens[i].contractSpend(
                i,
                inputCtxs,
                tracableTokens[i].trace,
                guard.getGuardInfo(guardInputIndex, guardPsbt.toTxHex(), guardPsbt.txState.stateHashList),
                index,
            ),
        );
    }
    const cat20StateArray = fill(CAT20Proto.create(0n, toByteString('')), TX_INPUT_COUNT_MAX);
    inputTokens.forEach((value, index) => {
        if (value) {
            cat20StateArray[index] = value.state;
        }
    });
    const inputStateProofArray = createInputStateProofArray();
    for (let index = 0; index < inputTokens.length; index++) {
        const tx = txHexToXrayedTxIdPreimg4(tracableTokens[index].trace.prevTxHex);
        const outputVal = BigInt(tracableTokens[index].token.utxo.outputIndex);
        const txStatesInfo = tracableTokens[index].trace.prevTxState.stateHashList;
        inputStateProofArray[index] = {
            prevTxPreimage: tx,
            prevOutputIndexVal: outputVal,
            stateHashes: txStatesInfo,
        };
    }
    const guardTxPreimg4 = txHexToXrayedTxIdPreimg4(guardPsbt.unsignedTx.toHex());
    // guard input state
    inputStateProofArray[inputTokens.length] = {
        prevTxPreimage: guardTxPreimg4,
        prevOutputIndexVal: 1n,
        stateHashes: guardPsbt.txState.stateHashList,
    };
    // fee input state
    inputStateProofArray[inputTokens.length + 1] = {
        prevTxPreimage: guardTxPreimg4,
        prevOutputIndexVal: 2n,
        stateHashes: guardPsbt.txState.stateHashList,
    };
    // unlock guard
    sendPsbt.updateCovenantInput(
        guardInputIndex,
        guard,
        guard.transfer(guardInputIndex, inputCtxs, outputTokens, inputStateProofArray, cat20StateArray),
    );

    return sendPsbt;
}

function estimateSentTxVSize(
    tracableTokens: TracedCat20Token[],
    guard: Cat20GuardCovenant,
    guardPsbt: CatPsbt,
    outputTokens: CAT20Covenant[],
    changeAddress: string,
    feeRate: number,
) {
    return buildSendTx(tracableTokens, guard, guardPsbt, outputTokens, changeAddress, feeRate).estimateVSize();
}
