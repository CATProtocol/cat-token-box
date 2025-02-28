import { ByteString, int2ByteString, UTXO } from 'scrypt-ts';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import {
    btc,
    CAT20Covenant,
    CAT20Proto,
    CatPsbt,
    ClosedMinter,
    ClosedMinterCat20Meta,
    ClosedMinterProto,
    ClosedMinterState,
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
    uint8ArrayToHex,
} from '../../../src/index';

export class ClosedMinterCovenant extends Covenant<ClosedMinterState> {
    // locked ClosedMinter artifact md5
    static readonly LOCKED_ASM_VERSION = 'fe60c526b65695c3070dfed2a8362734';

    readonly tokenScript: ByteString;

    constructor(
        readonly issuerAddress: string,
        readonly tokenId: string,
        state?: ClosedMinterState,
        network?: SupportedNetwork,
    ) {
        const contract = new ClosedMinter(toTokenAddress(issuerAddress), outpoint2ByteString(tokenId));
        super([{ contract }], {
            lockedAsmVersion: ClosedMinterCovenant.LOCKED_ASM_VERSION,
            network,
        });
        this.state = state;
        this.tokenScript = new CAT20Covenant(this.address).lockingScriptHex;
    }

    serializedState(): ByteString {
        return this.state ? ClosedMinterProto.propHashes(this.state) : '';
    }

    static buildCommitTx(
        info: ClosedMinterCat20Meta,
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
        metadata: ClosedMinterCat20Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
    ): {
        tokenId: string;
        minterAddr: string;
        tokenAddr: string;
        revealPsbt: CatPsbt;
    } {
        const minter = new ClosedMinterCovenant(address, `${commitUtxo.txId}_0`);

        const token = new CAT20Covenant(minter.address);

        minter.state = {
            tokenScript: token.lockingScriptHex,
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
            tokenId: `${commitUtxo.txId}_0`,
            minterAddr: minter.address,
            tokenAddr: token.address,
            revealPsbt: revealTx,
        };
    }

    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinterTxState: ProtocolState,
        spentMinter: ClosedMinterCovenant,
        tokenReceiver: ByteString,
        tokenAmount: bigint,
        feeUtxos: UTXO[],
        feeRate: number,
        changeAddress: string,
        address: string,
        pubKey: string,
        estimatedVSize?: number,
    ) {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }

        const mintTx = new CatPsbt();
        // add next minters outputs
        mintTx.addCovenantOutput(spentMinter, Postage.MINTER_POSTAGE);
        const token = spentMinter.createToken(tokenReceiver, tokenAmount);

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

        return mintTx;
    }

    static fromMintTx(address: string, tokenId: string, txHex: string, outputIndex?: number): ClosedMinterCovenant {
        const tx = Transaction.fromHex(txHex);
        const minterOutputIndex = outputIndex || 1;
        const minterOutput = tx.outs[minterOutputIndex];
        if (!minterOutput) {
            throw new Error(`Output[${minterOutputIndex}] not found in transaction`);
        }
        const minter = new ClosedMinterCovenant(toTokenAddress(address), tokenId, {
            tokenScript: uint8ArrayToHex(tx.ins[0].witness[13]),
        }).bindToUtxo({
            txId: tx.getId(),
            outputIndex: minterOutputIndex,
            satoshis: Postage.MINTER_POSTAGE,
        });

        if (Buffer.from(minterOutput.script).toString('hex') !== minter.lockingScriptHex) {
            throw new Error(`Invalid minter script in outputs[${outputIndex}]`);
        }
        minter.state = { tokenScript: minter.tokenScript };
        return minter;
    }

    private createToken(toAddr: ByteString, toAmount: bigint): CAT20Covenant {
        return new CAT20Covenant(this.address, CAT20Proto.create(toAmount, toAddr));
    }
}
