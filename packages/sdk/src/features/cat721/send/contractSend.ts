import {
    ByteString,
    ChainProvider,
    fill,
    getBackTraceInfo_,
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
    Sig,
    hash160,
} from '@scrypt-inc/scrypt-ts-btc';
import { CAT721Utxo, processExtPsbts } from '../../../lib/provider';
import { ExtPsbt } from '@scrypt-inc/scrypt-ts-btc';
import { Postage } from '../../../lib/constants';
import { filterFeeUtxos, uint8ArrayToHex } from '../../../lib/utils';
import { CAT721, CAT721Guard, CAT721State } from '../../../contracts';
import { CAT721Covenant, TracedCAT721Nft } from '../../../covenants/cat721Covenant';
import { CAT721GuardCovenant } from '../../../covenants/cat721GuardCovenant';

const getUtxos = async function (utxoProvider: UtxoProvider, address: string, limit?: number) {
    let utxos = await utxoProvider.getUtxos(address);

    utxos = filterFeeUtxos(utxos).slice(0, limit || utxos.length);

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount');
    }
    return utxos;
};

export async function contractSendNft(
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
        .change(changeAddress, feeRate)
        .seal();

    const guardInputIndex = inputNfts.length;
    // unlock tokens
    for (let i = 0; i < inputNfts.length; i++) {
        sendPsbt.updateCovenantInput(i, inputNfts[i], {
            invokeMethod: (contract: CAT721) => {
                const contractHash = contract.state.ownerAddr;
                const contractInputIndexVal = contract.ctx.spentScripts.findIndex((v) => hash160(v) === contractHash);
                contract.unlock(
                    {
                        isUserSpend: false,
                        userPubKeyPrefix: toByteString(''),
                        userXOnlyPubKey: toByteString('') as PubKey,
                        userSig: toByteString('') as Sig,
                        contractInputIndexVal: BigInt(contractInputIndexVal),
                    },
                    guard.state,
                    BigInt(guardInputIndex),
                    getBackTraceInfo_(
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
    sendPsbt.updateCovenantInput(guardInputIndex, guard, {
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
            contract.unlock(
                curPsbt.getTxoStateHashes(),
                nftOwners.map((ownerAddr, oidx) => {
                    const output = curPsbt.txOutputs[oidx + 1];
                    return ownerAddr || (output ? uint8ArrayToHex(output.script) : '');
                }) as unknown as FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
                nftLocalIds as unknown as FixedArray<Int32, typeof STATE_OUTPUT_COUNT_MAX>,
                nftScriptIndexArray,
                curPsbt.getOutputSatoshisList(),
                cat721StateArray,
                BigInt(curPsbt.txOutputs.length - 1),
            );
        },
    });
    return sendPsbt;
}
