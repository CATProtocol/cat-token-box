import { ByteString, int2ByteString, Ripemd160, Sig, UTXO } from 'scrypt-ts';
import { Covenant } from '../lib/covenant';
import { NftParallelClosedMinterCat721Meta } from '../lib/metadata';
import {
    isP2TR,
    outpoint2ByteString,
    outpoint2TxOutpoint,
    pubKeyPrefix,
    scriptToP2tr,
    toPsbt,
    toXOnly,
    uint8ArrayToHex,
} from '../lib/utils';
import { btc, LEAF_VERSION_TAPSCRIPT } from '../lib/btc';
import { Postage, SupportedNetwork } from '../lib/constants';
import { getCatCollectionCommitScript } from '../lib/commit';
import { CatPsbt } from '../lib/catPsbt';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import { ProtocolState } from '../lib/state';
import { getBackTraceInfo_ } from '../lib/proof';
import { NftParallelClosedMinterProto } from '../contracts/nft/minters/nftParallelClosedMinterProto';
import { NftParallelClosedMinter } from '../contracts/nft/minters/nftParallelClosedMinter';
import { CAT721Covenant } from './cat721Covenant';
import { CAT721Proto } from '../contracts/nft/cat721Proto';
import { NftParallelClosedMinterState } from '../contracts/nft/types';

export class NftParallelClosedMinterCovenant extends Covenant<NftParallelClosedMinterState> {
    // locked NftParallelClosedMinter artifact md5
    static readonly LOCKED_ASM_VERSION = '5300a4199c4939f8723e219ecb583a73';

    readonly nftScript: ByteString;

    constructor(
        readonly ownerAddress: ByteString,
        readonly collectionId: string,
        metadata: NftParallelClosedMinterCat721Meta,
        state?: NftParallelClosedMinterState,
        network?: SupportedNetwork,
    ) {
        const contract = new NftParallelClosedMinter(ownerAddress, outpoint2ByteString(collectionId), metadata.max);
        super([{ contract }], {
            lockedAsmVersion: NftParallelClosedMinterCovenant.LOCKED_ASM_VERSION,
            network,
        });
        this.state = state;
        this.nftScript = new CAT721Covenant(this.address).lockingScriptHex;
        this.ownerAddress = ownerAddress;
    }

    serializedState(): ByteString {
        return this.state ? NftParallelClosedMinterProto.propHashes(this.state) : '';
    }

    static buildCommitTx(
        info: NftParallelClosedMinterCat721Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
        changeAddress: string,
        feeRate: number,
        icon:
            | {
                  type: string;
                  body: string;
              }
            | undefined,
        revealTxOutputAmount: number = 0,
    ): {
        commitTxPsbt: Psbt;
        commitScript: string;
    } {
        const commitScript = getCatCollectionCommitScript(toXOnly(pubkey, isP2TR(address)), info, icon);
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
                    satoshis: revealTxOutputAmount,
                    script: changeScript,
                }),
            )
            .feePerByte(feeRate)
            .change(changeAddr);

        // if (commitTx.getChangeOutput() === null) {
        //   throw new Error('Insufficient satoshi balance!');
        // }

        const commitTxPsbt = toPsbt(commitTx);
        feeUtxos.forEach((utxo, index) => {
            commitTxPsbt.updateInput(index, {
                witnessUtxo: {
                    script: Buffer.from(utxo.script, 'hex'),
                    value: BigInt(utxo.satoshis),
                },
            });
        });

        return { commitScript, commitTxPsbt };
    }

    static buildRevealTx(
        commitUtxo: UTXO,
        ownerAddress: ByteString,
        metadata: NftParallelClosedMinterCat721Meta,
        commitScript: string,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
    ): {
        collectionId: string;
        minterAddr: string;
        collectionAddr: string;
        revealPsbt: CatPsbt;
    } {
        // metadata: NftParallelClosedMinterCat721Meta,
        // state?: NftParallelClosedMinterState,
        // network?: SupportedNetwork
        const minter = new NftParallelClosedMinterCovenant(ownerAddress, `${commitUtxo.txId}_0`, metadata);

        const nft = new CAT721Covenant(minter.address);

        minter.state = {
            nftScript: nft.lockingScriptHex,
            nextLocalId: 0n,
        };

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
        };
    }

    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinterTxState: ProtocolState,
        spentMinter: NftParallelClosedMinterCovenant,
        issuerPubKey: ByteString,
        nftReceiver: Ripemd160,
        commitUtxo: UTXO,
        nftScript: Buffer,
        feeUtxos: UTXO[],
        feeRate: number,
        changeAddress: string,
        estimatedVSize?: number,
    ) {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }

        const mintTx = new CatPsbt();

        const { nextMinters } = spentMinter.createNextMinters();

        // add next minters outputs
        for (const nextMinter of nextMinters) {
            mintTx.addCovenantOutput(nextMinter, Postage.MINTER_POSTAGE);
        }

        const nft = spentMinter.createNft(nftReceiver);
        const { cblock } = scriptToP2tr(nftScript);

        mintTx
            // add nft output
            .addCovenantOutput(nft, Postage.TOKEN_POSTAGE)
            // add minter input
            .addCovenantInput(spentMinter)
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
                        script: nftScript,
                        controlBlock: Buffer.from(cblock, 'hex'),
                    },
                ],
                finalizer: (self, inputIdx) => {
                    const witness = [
                        Buffer.from(
                            self.getSig(inputIdx, {
                                publicKey: issuerPubKey,
                                disableTweakSigner: isP2TR(changeAddress) ? false : true,
                            }),
                            'hex',
                        ),
                        nftScript,
                        Buffer.from(cblock, 'hex'),
                    ];
                    return witness;
                },
            })
            // add fees
            .addFeeInputs(feeUtxos)
            // add change output
            .change(changeAddress, feeRate, estimatedVSize);

        const inputCtxs = mintTx.calculateInputCtxs();

        const minterInputIndex = 0;

        const nftState = nft.state!;
        const preState = spentMinter.state!;
        // console.log('preState', preState)

        const preTxStatesInfo = {
            hashRoot: spentMinterTxState.hashRoot,
            stateHashes: spentMinterTxState.stateHashList,
        };
        // console.log('preTxStatesInfo', preTxStatesInfo)

        const backTraceInfo = getBackTraceInfo_(spentMinterTxHex, spentMinterPreTxHex, minterInputIndex);

        mintTx.updateCovenantInput(minterInputIndex, spentMinter, {
            method: 'mint',
            argsBuilder: (curPsbt) => {
                const inputCtx = inputCtxs.get(minterInputIndex);
                if (!inputCtx) {
                    throw new Error('Input context is not available');
                }
                const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx;
                const args = [];
                args.push(curPsbt.txState.stateHashList); // curTxoStateHashes
                args.push(nftState); // nftMint
                args.push(isP2TR(changeAddress) ? '' : pubKeyPrefix(issuerPubKey)); // issuerPubKeyPrefix
                args.push(toXOnly(issuerPubKey, isP2TR(changeAddress))); // issuerPubKey
                args.push(() =>
                    Sig(
                        curPsbt.getSig(0, {
                            publicKey: issuerPubKey,
                        }),
                    ),
                ); // issuerSig
                args.push(int2ByteString(BigInt(Postage.MINTER_POSTAGE), 8n)); // minterSatoshis
                args.push(int2ByteString(BigInt(Postage.TOKEN_POSTAGE), 8n)); // nftSatoshis
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

    static fromMintTx(
        collectionId: string,
        ownerAddr: ByteString,
        info: NftParallelClosedMinterCat721Meta,
        txHex: string,
        outputIndex?: number,
    ): NftParallelClosedMinterCovenant {
        const tx = Transaction.fromHex(txHex);

        const minterOutputIndex = outputIndex || 1;
        const minterOutput = tx.outs[minterOutputIndex];
        if (!minterOutput) {
            throw new Error(`Output[${minterOutputIndex}] not found in transaction`);
        }
        const minter = new NftParallelClosedMinterCovenant(ownerAddr, collectionId, info).bindToUtxo({
            txId: tx.getId(),
            outputIndex: minterOutputIndex,
            satoshis: Postage.MINTER_POSTAGE,
        });

        if (Buffer.from(minterOutput.script).toString('hex') !== minter.lockingScriptHex) {
            throw new Error(`Invalid minter script in outputs[${outputIndex}]`);
        }

        const minterInputIndex = 0;
        const minterInput = tx.ins[minterInputIndex];

        try {
            // console.log(minterInput)
            const preState = minter.getSubContractCallArg(
                minterInput.witness.map((w) => Buffer.from(w)),
                'mint',
                'curState',
            ) as NftParallelClosedMinterState;
            if (minterOutputIndex === 1) {
                minter.state = {
                    nftScript: minter.nftScript,
                    nextLocalId: preState.nextLocalId + preState.nextLocalId + 1n,
                };
            } else if (minterOutputIndex === 2) {
                minter.state = {
                    nftScript: minter.nftScript,
                    nextLocalId: preState.nextLocalId + preState.nextLocalId + 2n,
                };
            } else {
                throw new Error();
            }
        } catch (error) {
            const genesisOutput = outpoint2TxOutpoint(collectionId);
            if (genesisOutput.txHash === uint8ArrayToHex(minterInput.hash)) {
                minter.state = {
                    nftScript: minter.nftScript,
                    nextLocalId: 0n,
                };
            } else {
                throw new Error(
                    `Input[${minterInputIndex}] is not a valid minter input, or the transaction is not a mint transaction`,
                );
            }
        }

        return minter;
    }

    private createNextMinters(): {
        nextMinters: NftParallelClosedMinterCovenant[];
    } {
        const contract = this.getSubContract() as NftParallelClosedMinter;
        const nextMinters: NftParallelClosedMinterCovenant[] = [];
        const nextLocalIds = [
            this.state.nextLocalId + this.state.nextLocalId + 1n,
            this.state.nextLocalId + this.state.nextLocalId + 2n,
        ];
        nextLocalIds.forEach((nextLocalId) => {
            if (nextLocalId < contract.max) {
                const newState = {
                    nftScript: this.nftScript,
                    nextLocalId: nextLocalId,
                };
                nextMinters.push(this.next(newState) as NftParallelClosedMinterCovenant);
            }
        });
        return {
            nextMinters,
        };
    }

    private createNft(toAddr: Ripemd160): CAT721Covenant {
        return new CAT721Covenant(this.address, CAT721Proto.create(this.state.nextLocalId, toAddr));
    }
}
