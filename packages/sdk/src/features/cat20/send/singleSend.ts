import {
    ByteString,
    ChainProvider,
    fill,
    getBackTraceInfo_,
    Int32,
    markSpent,
    Signer,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
    UTXO,
    UtxoProvider,
    PubKey,
    FixedArray,
    emptyOutputByteStrings,
} from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Utxo } from '../../../lib/provider';
import { ExtPsbt } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Covenant, CAT20GuardCovenant, TracedCAT20Token } from '../../../covenants';
import { Postage } from '../../../lib/constants';
import { catToXOnly, filterFeeUtxos, isP2TR, pubKeyPrefix, uint8ArrayToHex } from '../../../lib/utils';
import { Psbt, address as Address } from '@scrypt-inc/bitcoinjs-lib';
import { CAT20, CAT20Guard, CAT20State } from '../../../contracts';

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
export async function singleSend(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterAddr: string,
    inputTokenUtxos: CAT20Utxo[],
    receivers: Array<{
        address: ByteString;
        amount: Int32;
    }>,
    tokenChangeAddress: ByteString,
    feeRate: number,
): Promise<{
    guardTx: ExtPsbt;
    sendTx: ExtPsbt;
    sendTxId: string;
    guardTxId: string;
    newCAT20Utxos: CAT20Utxo[];
    changeTokenOutputIndex: number;
}> {
    const pubkey = await signer.getPublicKey();
    const changeAddress = await signer.getAddress();

    let utxos = await utxoProvider.getUtxos(changeAddress);

    utxos = filterFeeUtxos(utxos).slice(0, TX_INPUT_COUNT_MAX);

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount');
    }

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

    const guardPsbt = buildGuardTx(guard, utxos, changeAddress, feeRate);

    const sendPsbt = buildSendTx(
        tracableTokens,
        guard,
        guardPsbt,
        changeAddress,
        pubkey,
        outputTokens,
        changeAddress,
        feeRate,
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
    const guardTxPsbt = await guardPsbt.combine(Psbt.fromHex(signedGuardPsbt)).finalizeAllInputs();
    const sendTxPsbt = await sendPsbt.combine(Psbt.fromHex(signedSendPsbt)).finalizeAllInputs();
    const guardTx = guardTxPsbt.extractTransaction();
    const sendTx = sendTxPsbt.extractTransaction();
    // broadcast the transactions
    await chainProvider.broadcast(guardTx.toHex());
    markSpent(utxoProvider, guardTx);
    await chainProvider.broadcast(sendTx.toHex());
    markSpent(utxoProvider, sendTx);

    const newCAT20Utxos: CAT20Utxo[] = outputTokens
        .filter((outputToken) => typeof outputToken !== 'undefined')
        .map((covenant, index) => ({
            ...sendTxPsbt.getStatefulCovenantUtxo(index + 1),
            state: covenant.state,
        }));

    const newFeeUtxo = sendPsbt.getChangeUTXO();

    utxoProvider.addNewUTXO(newFeeUtxo);

    return {
        sendTxId: sendTx.getId(),
        guardTxId: guardTx.getId(),
        guardTx: guardTxPsbt,
        sendTx: sendPsbt,
        newCAT20Utxos,
        changeTokenOutputIndex,
    };
}

function buildGuardTx(guard: CAT20GuardCovenant, feeUtxos: UTXO[], changeAddress: string, feeRate: number) {
    const guardTx = new ExtPsbt()
        .spendUTXO(feeUtxos)
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .change(changeAddress, feeRate)
        .seal();
    guard.bindToUtxo(guardTx.getStatefulCovenantUtxo(1));
    return guardTx;
}

function buildSendTx(
    tracableTokens: TracedCAT20Token[],
    guard: CAT20GuardCovenant,
    guardPsbt: ExtPsbt,
    address: string,
    pubKey: string,
    outputTokens: (CAT20Covenant | undefined)[],
    changeAddress: string,
    feeRate: number,
) {
    const inputTokens = tracableTokens.map((token) => token.token);

    if (inputTokens.length + 2 > TX_INPUT_COUNT_MAX) {
        throw new Error(`Too many inputs that exceed the maximum input limit of ${TX_INPUT_COUNT_MAX}`);
    }

    const sendPsbt = new ExtPsbt();

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

    sendPsbt.addCovenantInput(guard)
        .spendUTXO([guardPsbt.getUtxo(2)])
        .change(changeAddress, feeRate);

    const guardInputIndex = inputTokens.length;
    const _isP2TR = isP2TR(changeAddress);
    // unlock tokens
    for (let i = 0; i < inputTokens.length; i++) {
        sendPsbt.updateCovenantInput(i, inputTokens[i], {
            invokeMethod: (contract: CAT20, curPsbt: ExtPsbt) => {
                const sig = curPsbt.getSig(i, { address: address, disableTweakSigner: _isP2TR ? false : true });
                contract.unlock(
                    {
                        isUserSpend: true,
                        userPubKeyPrefix: _isP2TR ? '' : pubKeyPrefix(pubKey),
                        userXOnlyPubKey: PubKey(catToXOnly(pubKey, _isP2TR)),
                        userSig: sig,
                        contractInputIndexVal: -1n,
                    },
                    guard.state,
                    BigInt(guardInputIndex),
                    getBackTraceInfo_(
                        tracableTokens[i].trace.prevTxHex,
                        tracableTokens[i].trace.prevPrevTxHex,
                        tracableTokens[i].trace.prevTxInput,
                    ),
                );
            },
        });
    }
    const cat20StateArray = fill<CAT20State, typeof TX_INPUT_COUNT_MAX>(
        { ownerAddr: toByteString(''), amount: 0n },
        TX_INPUT_COUNT_MAX,
    );
    inputTokens.forEach((value, index) => {
        if (value) {
            cat20StateArray[index] = value.state;
        }
    });
    // unlock guard
    sendPsbt.updateCovenantInput(guardInputIndex, guard, {
        invokeMethod: (contract: CAT20Guard, curPsbt: ExtPsbt) => {
            const tokenOwners = outputTokens.map((output) => output?.state!.ownerAddr || '');
            const tokenAmounts = outputTokens.map((output) => output?.state!.amount || 0n);
            const tokenScriptIndexArray = fill(-1n, STATE_OUTPUT_COUNT_MAX);
            outputTokens.forEach((value, index) => {
                if (value) {
                    tokenScriptIndexArray[index] = 0n;
                }
            });

            const ownerAddrOrScripts = tokenOwners.map((ownerAddr, oidx) => {
                const output = curPsbt.txOutputs[oidx + 1];
                return (
                    ownerAddr ||
                    (output
                        ? uint8ArrayToHex(output.script)
                        : sendPsbt.isSealed
                        ? ''
                        : uint8ArrayToHex(Address.toOutputScript(changeAddress)))
                );
            }) as unknown as FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>;

            const outputSatoshisList = curPsbt.getOutputSatoshisList();
            const outputSatoshis = emptyOutputByteStrings().map((emtpyStr, i) => {
                if (outputSatoshisList[i + 1]) {
                    return outputSatoshisList[i + 1];
                } else {
                    return emtpyStr;
                }
                }) as FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>;

            contract.unlock(
                ownerAddrOrScripts,
                tokenAmounts as unknown as FixedArray<Int32, typeof STATE_OUTPUT_COUNT_MAX>,
                tokenScriptIndexArray,
                outputSatoshis,
                cat20StateArray,
                BigInt(curPsbt.txOutputs.length - 1),
            );
        },
    });
    sendPsbt.seal();
    return sendPsbt;
}
