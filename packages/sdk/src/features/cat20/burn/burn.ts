import {
    ChainProvider,
    fill,
    Signer,
    toByteString,
    TX_INPUT_COUNT_MAX,
    UTXO,
    UtxoProvider,
    ExtPsbt,
    PubKey,
    getBackTraceInfo_,
    ByteString,
    FixedArray,
    Int32,
    STATE_OUTPUT_COUNT_MAX,
    uint8ArrayToHex,
} from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Covenant, CAT20GuardCovenant, TracedCAT20Token } from '../../../covenants';
import { Postage } from '../../../lib/constants';
import { catToXOnly, filterFeeUtxos, isP2TR, pubKeyPrefix } from '../../../lib/utils';
import { CAT20Utxo } from '../../../lib/provider';
import { CAT20, CAT20Guard, CAT20State } from '../../../contracts';
import { Psbt } from '@scrypt-inc/bitcoinjs-lib';

/**
 * Burn CAT20 tokens in a single transaction.
 * @param signer a signer, such as {@link DefaultSigner}  or {@link UnisatSigner}
 * @param utxoProvider a  {@link UtxoProvider}
 * @param chainProvider a  {@link ChainProvider}
 * @param minterAddr the minter address of a CAT20 token
 * @param inputTokenUtxos CAT20 token utxos, all of which are to be burned
 * @param feeRate the fee rate for constructing transactions
 * @returns the guard transaction, the burn transaction
 */
export async function burn(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterAddr: string,
    inputTokenUtxos: CAT20Utxo[],
    feeRate: number,
): Promise<{
    guardTx: ExtPsbt;
    burnTx: ExtPsbt;
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

    const { guard, outputTokens } = CAT20Covenant.createBurnGuard(
        inputTokens.map((token, i) => ({
            token,
            inputIndex: i,
        })),
    );

    guard.state.tokenBurnAmounts[0] = guard.state.tokenAmounts[0];

    const guardPsbt = buildGuardTx(guard, utxos, changeAddress, feeRate);

    const sendPsbt = buildBurnTx(
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
    const guardTx = await guardPsbt.combine(Psbt.fromHex(signedGuardPsbt)).finalizeAllInputs();
    const sendTx = await sendPsbt.combine(Psbt.fromHex(signedSendPsbt)).finalizeAllInputs();

    // broadcast the transactions
    await chainProvider.broadcast(guardTx.extractTransaction().toHex());
    await chainProvider.broadcast(sendTx.extractTransaction().toHex());

    return {
        guardTx,
        burnTx: sendTx,
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

function buildBurnTx(
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

    sendPsbt
        .addCovenantInput(guard)
        .spendUTXO([guardPsbt.getUtxo(2)])
        .addOutput({
            script: sendPsbt.stateHashRootScript,
            value: BigInt(0),
        })
        .change(changeAddress, feeRate)
        .seal();

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
            contract.unlock(
                tokenOwners.map((ownerAddr, oidx) => {
                    const output = curPsbt.txOutputs[oidx + 1];
                    return ownerAddr || (output ? uint8ArrayToHex(output.script) : '');
                }) as unknown as FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
                tokenAmounts as unknown as FixedArray<Int32, typeof STATE_OUTPUT_COUNT_MAX>,
                tokenScriptIndexArray,
                curPsbt.getOutputSatoshisList(),
                cat20StateArray,
                BigInt(curPsbt.txOutputs.length - 1),
            );
        },
    });
    return sendPsbt;
}
