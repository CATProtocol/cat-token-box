import {
    ByteString,
    ChainProvider,
    fill,
    getBackTraceInfo,
    Int32,
    Signer,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
    UTXO,
    UtxoProvider,
    PubKey,
    FixedArray,
    Ripemd160,
    ExtPsbt,
} from '@scrypt-inc/scrypt-ts-btc';
import {
    CAT721Utxo,
    getUtxos,
    processExtPsbts,
    Postage,
    catToXOnly,
    emptyOutputByteStrings,
    isP2TR,
    pubKeyPrefix,
    uint8ArrayToHex
} from '../../../lib/index.js';
import { CAT721, CAT721Guard, CAT721State } from '../../../contracts/index.js';
import { CAT721Covenant, TracedCAT721Nft, CAT721GuardCovenant } from '../../../covenants/index.js';

export async function singleSendNft(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    minterAddr: string,
    inputNftUtxos: CAT721Utxo[],
    nftReceivers: Ripemd160[],
    feeRate: number,
): Promise<{
    guardTx: ExtPsbt;
    sendTx: ExtPsbt;
    newCAT721Utxos: CAT721Utxo[];
}> {
    const pubkey = await signer.getPublicKey();
    const changeAddress = await signer.getAddress();

    const utxos = await getUtxos(utxoProvider, changeAddress, TX_INPUT_COUNT_MAX);

    const tracableNfts = await CAT721Covenant.backtrace(
        inputNftUtxos.map((utxo) => {
            return { ...utxo, minterAddr };
        }),
        chainProvider,
    );

    const inputNfts = tracableNfts.map((nft) => nft.nft);
    const { guard, outputNfts } = CAT721Covenant.createTransferGuard(
        inputNfts.map((nft, i) => ({
            nft,
            inputIndex: i,
        })),
        inputNfts.map((nft, i) => ({
            address: nftReceivers[i],
            outputIndex: i + 1,
        })),
    );
    const guardPsbt = buildGuardTx(guard, utxos, changeAddress, feeRate);

    const sendPsbt = buildSendTx(
        tracableNfts,
        guard,
        guardPsbt,
        changeAddress,
        pubkey,
        outputNfts,
        changeAddress,
        feeRate,
    );

    const { psbts } = await processExtPsbts(signer, utxoProvider, chainProvider, [guardPsbt, sendPsbt]);

    const newCAT721Utxos: CAT721Utxo[] = outputNfts
        .filter((outputToken) => typeof outputToken !== 'undefined')
        .map((covenant, index) => ({
            ...psbts[1].getStatefulCovenantUtxo(index + 1),
            state: covenant.state,
        }));

    const newFeeUtxo = sendPsbt.getChangeUTXO();

    utxoProvider.addNewUTXO(newFeeUtxo);

    return {
        guardTx: psbts[0],
        sendTx: psbts[1],
        newCAT721Utxos: newCAT721Utxos,
    };
}

function buildGuardTx(guard: CAT721GuardCovenant, feeUtxos: UTXO[], changeAddress: string, feeRate: number) {
    const guardTx = new ExtPsbt()
        .spendUTXO(feeUtxos)
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .change(changeAddress, feeRate)
        .seal();
    guard.bindToUtxo(guardTx.getStatefulCovenantUtxo(1));
    return guardTx;
}

function buildSendTx(
    tracableNfts: TracedCAT721Nft[],
    guard: CAT721GuardCovenant,
    guardPsbt: ExtPsbt,
    address: string,
    pubKey: string,
    outputNfts: (CAT721Covenant | undefined)[],
    changeAddress: string,
    feeRate: number,
) {
    const inputNfts = tracableNfts.map((nft) => nft.nft);

    if (inputNfts.length + 2 > TX_INPUT_COUNT_MAX) {
        throw new Error(`Too many inputs that exceed the maximum input limit of ${TX_INPUT_COUNT_MAX}`);
    }

    const sendPsbt = new ExtPsbt();

    // add nft outputs
    for (const outputNft of outputNfts) {
        if (outputNft) {
            sendPsbt.addCovenantOutput(outputNft, Postage.TOKEN_POSTAGE);
        }
    }

    // add nft inputs
    for (const inputNft of inputNfts) {
        sendPsbt.addCovenantInput(inputNft);
    }

    sendPsbt
        .addCovenantInput(guard)
        .spendUTXO([guardPsbt.getUtxo(2)])
        .change(changeAddress, feeRate);

    const guardInputIndex = inputNfts.length;
    const _isP2TR = isP2TR(changeAddress);
    // unlock tokens
    for (let i = 0; i < inputNfts.length; i++) {
        sendPsbt.updateCovenantInput(i, inputNfts[i], {
            invokeMethod: (contract: CAT721, curPsbt: ExtPsbt) => {
                const sig = curPsbt.getSig(i, { address: address, disableTweakSigner: _isP2TR ? false : true });
                contract.unlock(
                    {
                        userPubKeyPrefix: _isP2TR ? '' : pubKeyPrefix(pubKey),
                        userXOnlyPubKey: PubKey(catToXOnly(pubKey, _isP2TR)),
                        userSig: sig,
                        contractInputIndexVal: -1n,
                    },
                    guard.state,
                    BigInt(guardInputIndex),
                    getBackTraceInfo(
                        tracableNfts[i].trace.prevTxHex,
                        tracableNfts[i].trace.prevPrevTxHex,
                        tracableNfts[i].trace.prevTxInput,
                    ),
                );
            },
        });
    }
    const cat721StateArray = fill<CAT721State, typeof TX_INPUT_COUNT_MAX>(
        { ownerAddr: toByteString(''), localId: 0n },
        TX_INPUT_COUNT_MAX,
    );
    inputNfts.forEach((value, index) => {
        if (value) {
            cat721StateArray[index] = value.state;
        }
    });
    // unlock guard
    sendPsbt
        .updateCovenantInput(guardInputIndex, guard, {
            invokeMethod: (contract: CAT721Guard, curPsbt: ExtPsbt) => {
                const nftOwners = outputNfts.map((output) => output?.state!.ownerAddr || '');
                const nftLocalIds = outputNfts.map((output) =>
                    output?.state!.localId >= 0n ? output?.state!.localId : -1n,
                );
                const nftScriptIndexArray = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                outputNfts.forEach((value, index) => {
                    if (value) {
                        nftScriptIndexArray[index] = 0n;
                    }
                });

                const outputSatoshisList = curPsbt.getOutputSatoshisList();
                const outputSatoshis = emptyOutputByteStrings().map((emtpyStr, i) => {
                    if (outputSatoshisList[i + 1]) {
                        return outputSatoshisList[i + 1];
                    } else {
                        return emtpyStr;
                    }
                }) as FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>;
                contract.unlock(
                    nftOwners.map((ownerAddr, oidx) => {
                        const output = curPsbt.txOutputs[oidx + 1];
                        return ownerAddr || (output ? uint8ArrayToHex(output.script) : '');
                    }) as unknown as FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
                    nftLocalIds as unknown as FixedArray<Int32, typeof STATE_OUTPUT_COUNT_MAX>,
                    nftScriptIndexArray,
                    outputSatoshis,
                    cat721StateArray,
                    BigInt(curPsbt.txOutputs.length - 1),
                );
            },
        })
        .seal();
    return sendPsbt;
}
