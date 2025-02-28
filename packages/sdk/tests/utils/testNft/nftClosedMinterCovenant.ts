import { ByteString, int2ByteString, UTXO } from 'scrypt-ts';
import { Psbt } from 'bitcoinjs-lib';
import {
    btc,
    CatPsbt,
    NftClosedMinter,
    NftClosedMinterCat721Meta,
    NftClosedMinterProto,
    NftClosedMinterState,
    Covenant,
    getBackTraceInfo_,
    getCatCommitScript,
    isP2TR,
    LEAF_VERSION_TAPSCRIPT,
    outpoint2ByteString,
    Postage,
    ProtocolState,
    pubKeyPrefix,
    scriptToP2tr,
    SupportedNetwork,
    toPsbt,
    toTokenAddress,
    toXOnly,
    CAT721Proto,
    CAT721Covenant,
    Cat721ClosedMinterUtxo,
} from '../../../src/index';

export class NftClosedMinterCovenant extends Covenant<NftClosedMinterState> {
    // locked ClosedMinter artifact md5
    static readonly LOCKED_ASM_VERSION = 'fe60c526b65695c3070dfed2a8362734';

    readonly collectionScript: ByteString;

    constructor(
        readonly issuerAddress: string,
        readonly collectionId: string,
        state?: NftClosedMinterState,
        network?: SupportedNetwork,
    ) {
        const contract = new NftClosedMinter(toTokenAddress(issuerAddress), outpoint2ByteString(collectionId), 10000n);
        super([{ contract }], {
            lockedAsmVersion: NftClosedMinterCovenant.LOCKED_ASM_VERSION,
            network,
        });
        this.state = state;
        this.collectionScript = new CAT721Covenant(this.address).lockingScriptHex;
    }

    serializedState(): ByteString {
        return this.state ? NftClosedMinterProto.propHashes(this.state) : '';
    }

    static buildCommitTx(
        info: NftClosedMinterCat721Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
        totalOutputsAmount: number,
        changeAddress: string,
        feeRate: number,
    ): Psbt {
        const commitScript = getCatCommitScript(toXOnly(pubkey, isP2TR(address)), info);
        const { p2trLockingScript } = scriptToP2tr(Buffer.from(commitScript, 'hex'));
        const changeAddr = btc.Address.fromString(changeAddress);
        const changeScript = btc.Script.fromAddress(changeAddr);

        const commitTx = new btc.Transaction()
            .from(feeUtxos)
            .addOutput(
                /** the first utxo spent in reveal tx */
                new btc.Transaction.Output({
                    satoshis: Postage.METADATA_POSTAGE,
                    script: p2trLockingScript,
                }),
            )
            .addOutput(
                /** the second utxo spent in reveal tx */
                new btc.Transaction.Output({
                    satoshis:
                        totalOutputsAmount > Postage.METADATA_POSTAGE
                            ? Math.max(546, totalOutputsAmount - Postage.METADATA_POSTAGE)
                            : 0,
                    script: changeScript,
                }),
            )
            .feePerByte(feeRate)
            .change(changeAddr);

        if (commitTx.getChangeOutput() === null) {
            throw new Error('Insufficient satoshi balance!');
        }

        commitTx.getChangeOutput().satoshis -= 1;

        const commitTxPsbt = toPsbt(commitTx);
        feeUtxos.forEach((utxo, index) => {
            commitTxPsbt.updateInput(index, {
                witnessUtxo: {
                    script: Buffer.from(utxo.script, 'hex'),
                    value: BigInt(utxo.satoshis),
                },
            });
        });

        return commitTxPsbt;
    }

    static buildRevealTx(
        commitUtxo: UTXO,
        metadata: NftClosedMinterCat721Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
    ): {
        collectionId: string;
        minterAddr: string;
        collectionAddr: string;
        revealPsbt: CatPsbt;
        minterUtxo: Cat721ClosedMinterUtxo;
    } {
        const minter = new NftClosedMinterCovenant(address, `${commitUtxo.txId}_0`);

        const nft = new CAT721Covenant(minter.address);

        minter.state = {
            nftScript: nft.lockingScriptHex,
            maxLocalId: metadata.max,
            nextLocalId: 0n,
        };

        const commitScript = getCatCommitScript(toXOnly(pubkey, isP2TR(address)), metadata);
        const commitLockingScript = Buffer.from(commitScript, 'hex');
        const { cblock } = scriptToP2tr(commitLockingScript);

        const revealTx = CatPsbt.create()
            .addCovenantOutput(minter, Postage.MINTER_POSTAGE)
            .addInput({
                hash: commitUtxo.txId,
                index: 0,
                witnessUtxo: {
                    script: Buffer.from(commitUtxo.script, 'hex'),
                    value: BigInt(commitUtxo.satoshis),
                },
                // tapInternalKey: Buffer.from(TAPROOT_ONLY_SCRIPT_SPENT_KEY, 'hex'),
                tapLeafScript: [
                    {
                        leafVersion: LEAF_VERSION_TAPSCRIPT,
                        script: commitLockingScript,
                        controlBlock: Buffer.from(cblock, 'hex'),
                    },
                ],
                finalizer: (self, inputIdx) => {
                    const witness = [
                        ...self.txState.stateHashList.map((hash) => Buffer.from(hash, 'hex')),
                        Buffer.from(
                            self.getSig(inputIdx, {
                                publicKey: pubkey,
                                disableTweakSigner: isP2TR(address) ? false : true,
                            }),
                            'hex',
                        ),
                        commitLockingScript,
                        Buffer.from(cblock, 'hex'),
                    ];
                    return witness;
                },
            })
            .addFeeInputs(feeUtxos);
        // NOTE: can not have a fee change output here due to the protocol
        return {
            collectionId: `${commitUtxo.txId}_0`,
            minterAddr: minter.address,
            collectionAddr: nft.address,
            revealPsbt: revealTx,
            minterUtxo: {
                utxo: revealTx.getUtxo(1),
                txoStateHashes: revealTx.txState.stateHashList,
                state: minter.state,
            },
        };
    }

    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinterTxState: ProtocolState,
        spentMinter: NftClosedMinterCovenant,
        tokenReceiver: ByteString,
        tokenAmount: bigint,
        feeUtxos: UTXO[],
        feeRate: number,
        changeAddress: string,
        address: string,
        pubKey: string,
        estimatedVSize?: number,
    ): { mintTx: CatPsbt; nextMinter: NftClosedMinterCovenant } {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }

        const mintTx = new CatPsbt();
        const nextMinter = spentMinter.next({
            ...spentMinter.state!,
            nextLocalId: spentMinter.state!.nextLocalId + 1n,
        }) as NftClosedMinterCovenant;

        // spentMinter.state.nextLocalId
        // add next minters outputs
        mintTx.addCovenantOutput(nextMinter, Postage.MINTER_POSTAGE);
        const token = spentMinter.createNft(tokenReceiver, tokenAmount);

        mintTx
            // add token output
            .addCovenantOutput(token, Postage.TOKEN_POSTAGE)
            // add minter input
            .addCovenantInput(spentMinter)
            // add fees
            .addFeeInputs(feeUtxos)
            // add change output
            .change(changeAddress, feeRate, estimatedVSize);

        const inputCtxs = mintTx.calculateInputCtxs();

        const minterInputIndex = 0;

        const tokenState = token.state!;
        const preState = spentMinter.state!;

        const preTxStatesInfo = {
            hashRoot: spentMinterTxState.hashRoot,
            stateHashes: spentMinterTxState.stateHashList,
        };

        const backTraceInfo = getBackTraceInfo_(spentMinterTxHex, spentMinterPreTxHex, minterInputIndex);

        mintTx.updateCovenantInput(minterInputIndex, spentMinter, {
            method: 'mint',
            argsBuilder: (curPsbt) => {
                const inputCtx = inputCtxs.get(minterInputIndex);
                if (!inputCtx) {
                    throw new Error('Input context is not available');
                }

                const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx;

                const args = [] as unknown[];
                args.push(curPsbt.txState.stateHashList); // curTxoStateHashes
                args.push(tokenState); // tokenMint
                args.push(isP2TR(address) ? '' : pubKeyPrefix(pubKey)); // issuerPubKeyPrefix
                args.push(toXOnly(pubKey, isP2TR(address))); // issuerPubKey
                args.push(() => {
                    return curPsbt.getSig(minterInputIndex, {
                        publicKey: pubKey,
                    });
                }); // issuerSig
                args.push(int2ByteString(BigInt(Postage.MINTER_POSTAGE), 8n)); // minterSatoshis
                args.push(int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n)); // tokenSatoshis
                args.push(preState); // preState
                args.push(preTxStatesInfo.stateHashes); // preTxStatesInfo
                args.push(backTraceInfo); // backtraceInfo
                args.push(shPreimage); // shPreimage
                args.push(prevoutsCtx); // prevoutsCtx
                args.push(spentScriptsCtx); // spentScriptsCtx
                args.push(curPsbt.getChangeInfo()); // changeInfo
                return args;
            },
        });
        return { mintTx, nextMinter };
    }

    private createNft(toAddr: ByteString, localId: bigint): CAT721Covenant {
        return new CAT721Covenant(this.address, CAT721Proto.create(localId, toAddr));
    }
}
