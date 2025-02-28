import { ByteString, hash160, int2ByteString, Ripemd160, UTXO } from 'scrypt-ts';
import { Covenant } from '../lib/covenant';
import { NftOpenMinterCat721Meta } from '../lib/metadata';
import { isP2TR, outpoint2ByteString, pubKeyPrefix, scriptToP2tr, toPsbt, toXOnly } from '../lib/utils';
import { NftOpenMinterProto } from '../contracts/nft/minters/nftOpenMinterProto';
import { OpenMinter } from '../contracts/token/minters/openMinter';
import { NftOpenMinter } from '../contracts/nft/minters/nftOpenMinter';
import { btc, LEAF_VERSION_TAPSCRIPT } from '../lib/btc';
import { Postage, SupportedNetwork } from '../lib/constants';
import { getCatCommitScript } from '../lib/commit';
import { CatPsbt } from '../lib/catPsbt';
import { Psbt } from 'bitcoinjs-lib';
import { MerkleProof, NftMerkleLeaf, NftOpenMinterState, ProofNodePos } from '../contracts/nft/types';
import { CAT721Covenant } from './cat721Covenant';
import { CAT721Proto } from '../contracts/nft/cat721Proto';
import { ProtocolState } from '../lib/state';
import { getBackTraceInfo_ } from '../lib/proof';

export const PROOF_NODE_ON_RIGHT = true;
export const PROOF_NODE_ON_LEFT = false;

export class NftOpenMinterMerkleTreeData {
    leafArray: NftMerkleLeaf[] = [];
    height: number;
    emptyHashs: string[] = [];
    hashNodes: string[][] = [];
    maxLeafSize: number;

    constructor(leafArray: NftMerkleLeaf[], height: number) {
        this.height = height;
        this.maxLeafSize = Math.pow(2, this.height - 1);
        this.leafArray = leafArray;
        const emptyHash = hash160('');
        this.emptyHashs.push(emptyHash);
        for (let i = 1; i < height; i++) {
            const prevHash = this.emptyHashs[i - 1];
            this.emptyHashs[i] = hash160(prevHash + prevHash);
        }

        this.buildMerkleTree();
    }

    getLeaf(index: number) {
        return this.leafArray[index];
    }

    get merkleRoot() {
        return this.hashNodes[this.hashNodes.length - 1][0];
    }

    getMerklePath(leafIndex: number): {
        leaf: Ripemd160;
        leafNode: NftMerkleLeaf;
        neighbor: string[];
        neighborType: boolean[];
        merkleRoot: string;
    } {
        const leafNode = this.leafArray[leafIndex];
        let prevHash = this.hashNodes[0];
        const neighbor: string[] = [];
        const neighborType: boolean[] = [];

        const leafNodeHash = hash160(NftOpenMinterProto.leafPropHashes(leafNode));
        if (leafIndex < prevHash.length) {
            prevHash[leafIndex] = leafNodeHash;
        } else {
            prevHash.push(leafNodeHash);
        }

        let prevIndex = leafIndex;

        for (let i = 1; i < this.height; i++) {
            prevHash = this.hashNodes[i - 1];
            const curHash = this.hashNodes[i];

            const curIndex = Math.floor(prevIndex / 2);
            // right node
            if (prevIndex % 2 === 1) {
                neighbor.push(prevHash[prevIndex - 1]);
                neighborType.push(PROOF_NODE_ON_LEFT);
            } else {
                // left node
                if (curIndex >= curHash.length) {
                    neighbor.push(this.emptyHashs[i - 1]);
                    neighborType.push(PROOF_NODE_ON_RIGHT);
                } else {
                    if (prevHash.length > prevIndex + 1) {
                        neighbor.push(prevHash[prevIndex + 1]);
                        neighborType.push(PROOF_NODE_ON_RIGHT);
                    } else {
                        neighbor.push(this.emptyHashs[i - 1]);
                        neighborType.push(PROOF_NODE_ON_RIGHT);
                    }
                }
            }
            prevIndex = curIndex;
        }
        neighbor.push('');
        neighborType.push(false);
        return {
            leaf: leafNodeHash,
            leafNode: leafNode,
            neighbor,
            neighborType,
            merkleRoot: this.merkleRoot,
        };
    }

    updateLeaf(leaf: NftMerkleLeaf, leafIndex: number) {
        const oldLeaf = this.leafArray[leafIndex];
        this.leafArray[leafIndex] = leaf;
        // return merkle path
        const { neighbor, neighborType } = this.updateMerkleTree(leaf, leafIndex);
        return {
            oldLeaf,
            neighbor,
            neighborType,
            leafIndex,
            newLeaf: leaf,
            merkleRoot: this.merkleRoot,
        };
    }

    updateMerkleTree(leaf: NftMerkleLeaf, leafIndex: number) {
        let prevHash = this.hashNodes[0];
        const neighbor: string[] = [];
        const neighborType: boolean[] = [];
        if (leafIndex < prevHash.length) {
            prevHash[leafIndex] = hash160(NftOpenMinterProto.leafPropHashes(leaf));
        } else {
            prevHash.push(hash160(NftOpenMinterProto.leafPropHashes(leaf)));
        }

        let prevIndex = leafIndex;

        for (let i = 1; i < this.height; i++) {
            prevHash = this.hashNodes[i - 1];
            const curHash = this.hashNodes[i];

            const curIndex = Math.floor(prevIndex / 2);
            // right node
            if (prevIndex % 2 === 1) {
                const newHash = hash160(prevHash[prevIndex - 1] + prevHash[prevIndex]);
                curHash[curIndex] = newHash;
                neighbor.push(prevHash[prevIndex - 1]);
                neighborType.push(PROOF_NODE_ON_LEFT);
            } else {
                // left node
                // new add
                let newHash;
                if (curIndex >= curHash.length) {
                    newHash = hash160(prevHash[prevIndex] + this.emptyHashs[i - 1]);
                    if (curHash.length !== curIndex) {
                        throw Error('wrong curHash');
                    }
                    curHash.push(newHash);
                    neighbor.push(this.emptyHashs[i - 1]);
                    neighborType.push(PROOF_NODE_ON_RIGHT);
                } else {
                    if (prevHash.length > prevIndex + 1) {
                        newHash = hash160(prevHash[prevIndex] + prevHash[prevIndex + 1]);
                        neighbor.push(prevHash[prevIndex + 1]);
                        neighborType.push(PROOF_NODE_ON_RIGHT);
                    } else {
                        newHash = hash160(prevHash[prevIndex] + this.emptyHashs[i - 1]);
                        neighbor.push(this.emptyHashs[i - 1]);
                        neighborType.push(PROOF_NODE_ON_RIGHT);
                    }
                    curHash[curIndex] = newHash;
                }
            }
            prevIndex = curIndex;
        }
        neighbor.push('');
        neighborType.push(false);
        return { neighbor, neighborType };
    }

    private buildMerkleTree() {
        this.hashNodes = [];
        let prevHash: string[] = [];
        let curHash: string[] = [];

        for (let i = 0; i < this.leafArray.length; i++) {
            prevHash.push(hash160(NftOpenMinterProto.leafPropHashes(this.leafArray[i])));
        }
        if (prevHash.length > 0) {
            this.hashNodes.push(prevHash);
        } else {
            this.hashNodes.push([this.emptyHashs[0]]);
        }

        for (let i = 1; i < this.height; i++) {
            prevHash = this.hashNodes[i - 1];
            curHash = [];
            for (let j = 0; j < prevHash.length; ) {
                if (j + 1 < prevHash.length) {
                    curHash.push(hash160(prevHash[j] + prevHash[j + 1]));
                } else {
                    curHash.push(hash160(prevHash[j] + this.emptyHashs[i - 1]));
                }
                j += 2;
            }
            this.hashNodes.push(curHash);
        }
    }
}

export class NftOpenMinterCovenant extends Covenant<NftOpenMinterState> {
    // locked OpenMinter artifact md5
    static readonly LOCKED_ASM_VERSION = 'a989365de2bb63e67f4208497806151a';

    readonly nftScript: ByteString;

    readonly metadata: NftOpenMinterCat721Meta;

    constructor(
        readonly collectionId: string,
        metadata: NftOpenMinterCat721Meta,
        state?: NftOpenMinterState,
        network?: SupportedNetwork,
    ) {
        const contract = new NftOpenMinter(
            outpoint2ByteString(collectionId),
            metadata.max,
            metadata.premine,
            metadata.preminerAddr,
        );
        super([{ contract }], {
            lockedAsmVersion: NftOpenMinterCovenant.LOCKED_ASM_VERSION,
            network,
        });
        this.state = state;
        this.nftScript = new CAT721Covenant(this.address).lockingScriptHex;
        this.metadata = metadata;
    }

    serializedState(): ByteString {
        return this.state ? NftOpenMinterProto.propHashes(this.state) : '';
    }

    static buildCommitTx(
        info: NftOpenMinterCat721Meta,
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
        metadata: NftOpenMinterCat721Meta,
        initMerkleRoot: ByteString,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
    ): {
        collectionId: string;
        minterAddr: string;
        nftAddr: string;
        revealPsbt: CatPsbt;
        minter: NftOpenMinterCovenant;
    } {
        const minter = new NftOpenMinterCovenant(`${commitUtxo.txId}_0`, metadata);

        const nft = new CAT721Covenant(minter.address);

        minter.state = {
            nftScript: nft.lockingScriptHex,
            merkleRoot: initMerkleRoot,
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
        minter.bindToUtxo(revealTx.getUtxo(1));
        return {
            collectionId: `${commitUtxo.txId}_0`,
            minterAddr: minter.address,
            nftAddr: nft.address,
            revealPsbt: revealTx,
            minter: minter,
        };
    }

    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinterTxState: ProtocolState,
        spentMinter: NftOpenMinterCovenant,
        nftReceiver: ByteString,
        commintUtxo: UTXO,
        proof: MerkleProof,
        proofNodePos: ProofNodePos,
        nextMerkleRoot: string,
        feeUtxos: UTXO[],
        feeRate: number,
        changeAddress: string,
        estimatedVSize?: number,
        preminterAddress?: string,
        preminerPubKey?: string,
    ) {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }

        const mintTx = new CatPsbt();

        const { nextMinter } = spentMinter.createNextMinter(nextMerkleRoot);

        // add next minters outputs
        mintTx.addCovenantOutput(nextMinter, Postage.MINTER_POSTAGE);

        const nft = spentMinter.createNft(nftReceiver);

        mintTx
            // add nft output
            .addCovenantOutput(nft, Postage.TOKEN_POSTAGE)
            // add minter input
            .addCovenantInput(spentMinter)
            //
            .addFeeInputs([commintUtxo])
            // add fees
            .addFeeInputs(feeUtxos)
            // add change output
            .change(changeAddress, feeRate, estimatedVSize);

        mintTx.setInputFinalizer(1, async () => []);

        const inputCtxs = mintTx.calculateInputCtxs();

        const minterInputIndex = 0;

        const nftState = nft.state!;
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

                const args = [];
                args.push(curPsbt.txState.stateHashList); // curTxoStateHashes
                args.push(nftState); // nftMint
                args.push(proof); //
                args.push(proofNodePos);
                args.push(isP2TR(preminterAddress) ? '' : pubKeyPrefix(preminerPubKey)); // preminerPubKeyPrefix
                args.push(toXOnly(preminerPubKey, isP2TR(preminterAddress))); // preminerPubKey
                args.push(() => {
                    return curPsbt.getSig(minterInputIndex, {
                        publicKey: preminerPubKey,
                    }); //Sig(toByteString(''))
                }); // preminerSig
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
        nextMinter.bindToUtxo(mintTx.getUtxo(1));
        return { mintTx, nextMinter };
    }

    private createNextMinter(nextMerkleRoot: string): {
        nextMinter: NftOpenMinterCovenant;
    } {
        const newState: NftOpenMinterState = {
            nftScript: this.state.nftScript,
            merkleRoot: nextMerkleRoot,
            nextLocalId: this.state.nextLocalId + 1n,
        };
        return {
            nextMinter: this.next(newState) as NftOpenMinterCovenant,
        };
    }

    private createNft(toAddr: ByteString): CAT721Covenant {
        const contract = this.getSubContract() as OpenMinter;
        const localId = this.state.nextLocalId;
        let receiverAddr = toAddr;
        if (contract.premine > 0n && this.state.nextLocalId < contract.premine) {
            receiverAddr = this.metadata.preminerAddr;
        }
        return new CAT721Covenant(this.address, CAT721Proto.create(localId, receiverAddr));
    }
}
