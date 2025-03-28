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
    emptyOutputByteStrings,
} from '@scrypt-inc/scrypt-ts-btc';
import { Postage } from '../../../lib/constants';
import { catToXOnly, isP2TR, pubKeyPrefix } from '../../../lib/utils';
import { CAT721Utxo, getUtxos, processExtPsbts } from '../../../lib/provider';
import { CAT721, CAT721Guard, CAT721State } from '../../../contracts';
import { CAT721Covenant, TracedCAT721Nft } from '../../../covenants/cat721Covenant';
import { CAT721GuardCovenant } from '../../../covenants/cat721GuardCovenant';

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
    inputNftUtxos: CAT721Utxo[],
    feeRate: number,
): Promise<{
    guardTx: ExtPsbt;
    burnTx: ExtPsbt;
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

    const { guard } = CAT721Covenant.createBurnGuard(
        inputNfts.map((nft, i) => ({
            nft,
            inputIndex: i,
        })),
    );

    const guardPsbt = buildGuardTx(guard, utxos, changeAddress, feeRate);

    const sendPsbt = buildBurnTx(tracableNfts, guard, guardPsbt, changeAddress, pubkey, changeAddress, feeRate);

    const {
        psbts: [guardTx, sendTx],
    } = await processExtPsbts(signer, utxoProvider, chainProvider, [guardPsbt, sendPsbt]);

    return {
        guardTx,
        burnTx: sendTx,
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

function buildBurnTx(
    tracableNfts: TracedCAT721Nft[],
    guard: CAT721GuardCovenant,
    guardPsbt: ExtPsbt,
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
) {
    const inputNfts = tracableNfts.map((nft) => nft.nft);

    if (inputNfts.length + 2 > TX_INPUT_COUNT_MAX) {
        throw new Error(`Too many inputs that exceed the maximum input limit of ${TX_INPUT_COUNT_MAX}`);
    }

    const sendPsbt = new ExtPsbt();

    // add token inputs
    for (const inputToken of inputNfts) {
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

    const guardInputIndex = inputNfts.length;

    const _isP2TR = isP2TR(changeAddress);
    // unlock tokens
    for (let i = 0; i < inputNfts.length; i++) {
        sendPsbt.updateCovenantInput(i, inputNfts[i], {
            invokeMethod: (contract: CAT721, curPsbt: ExtPsbt) => {
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
            const nftOwners = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
            const nftLocalIds = fill(-1n, STATE_OUTPUT_COUNT_MAX);
            const nftScriptIndexArray = fill(-1n, STATE_OUTPUT_COUNT_MAX);

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
