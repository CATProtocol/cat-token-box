import { LEAF_VERSION_TAPSCRIPT, Transaction } from '@scrypt-inc/bitcoinjs-lib';
import {
    StatefulCovenant,
    ByteString,
    SupportedNetwork,
    UTXO,
    Ripemd160,
    getBackTraceInfo,
    ExtPsbt,
    hexToUint8Array,
    PubKey,
    uint8ArrayToHex,
    hash160,
    toXOnly,
    StateHashes,
    Int32,
} from '@scrypt-inc/scrypt-ts-btc';
import { getCatCollectionCommitScript } from '../lib/commit';
import { Postage } from '../lib/constants';
import { OpenMinterCat721Meta } from '../lib/metadata';
import {
    outpoint2ByteString,
    isP2TR,
    scriptToP2tr,
    toTokenAddress,
    catToXOnly,
    pubKeyPrefix,
    satoshiToHex,
    byteStringToBigInt,
} from '../lib/utils';
import { CAT721MerkleLeaf, CAT721OpenMinterState, MerkleProof, ProofNodePos } from '../contracts';
import { CAT721OpenMinter } from '../contracts/cat721/minters/cat721OpenMinter';
import { CAT721Covenant } from './cat721Covenant';
import { CAT721OpenMinterMerkleTree } from '../contracts/cat721/minters/cat721OpenMinterMerkleTree';
import { CAT721OpenMinterUtxo } from '../lib/provider';

export const PROOF_NODE_ON_RIGHT = true;
export const PROOF_NODE_ON_LEFT = false;

export class CAT721OpenMinterMerkleTreeData {
    leafArray: CAT721MerkleLeaf[] = [];
    height: number;
    emptyHashs: string[] = [];
    hashNodes: string[][] = [];
    maxLeafSize: number;

    constructor(leafArray: CAT721MerkleLeaf[], height: number) {
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
        leafNode: CAT721MerkleLeaf;
        neighbor: string[];
        neighborType: boolean[];
        merkleRoot: string;
    } {
        const leafNode = this.leafArray[leafIndex];
        let prevHash = this.hashNodes[0];
        const neighbor: string[] = [];
        const neighborType: boolean[] = [];

        const leafNodeHash = hash160(CAT721OpenMinterMerkleTree.leafPropHashes(leafNode));
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

    updateLeaf(leaf: CAT721MerkleLeaf, leafIndex: number) {
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

    updateMerkleTree(leaf: CAT721MerkleLeaf, leafIndex: number) {
        let prevHash = this.hashNodes[0];
        const neighbor: string[] = [];
        const neighborType: boolean[] = [];
        if (leafIndex < prevHash.length) {
            prevHash[leafIndex] = hash160(CAT721OpenMinterMerkleTree.leafPropHashes(leaf));
        } else {
            prevHash.push(hash160(CAT721OpenMinterMerkleTree.leafPropHashes(leaf)));
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
            prevHash.push(hash160(CAT721OpenMinterMerkleTree.leafPropHashes(this.leafArray[i])));
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

export class CAT721OpenMinterCovenant extends StatefulCovenant<CAT721OpenMinterState> {
    readonly nftScript: ByteString;

    readonly metadata: OpenMinterCat721Meta;
    constructor(
        readonly collectionId: string,
        metadata: OpenMinterCat721Meta,
        state?: CAT721OpenMinterState,
        network?: SupportedNetwork,
    ) {
        if (metadata.premine > 0 && !metadata.preminerAddr) {
            throw new Error('Preminer public key is required for premining');
        }
        const contract = new CAT721OpenMinter(
            outpoint2ByteString(collectionId),
            metadata.max,
            metadata.premine || 0n,
            metadata.preminerAddr || '',
        );
        super(state, [{ contract }], { network });
        this.nftScript = new CAT721Covenant(this.address).lockingScriptHex;
        this.metadata = metadata;
    }

    static buildCommitTx(
        info: OpenMinterCat721Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
        totalOutputsAmount: number,
        changeAddress: string,
        feeRate: number,
    ): ExtPsbt {
        const commitScript = getCatCollectionCommitScript(catToXOnly(pubkey, isP2TR(address)), info);
        const { p2trLockingScript } = scriptToP2tr(Buffer.from(commitScript, 'hex'));

        const commitTxPsbt = new ExtPsbt()
            .spendUTXO(feeUtxos)
            .addOutput({
                value: BigInt(Postage.METADATA_POSTAGE),
                script: hexToUint8Array(p2trLockingScript),
            })
            .addOutput({
                value: BigInt(
                    totalOutputsAmount > Postage.METADATA_POSTAGE
                        ? Math.max(546, totalOutputsAmount - Postage.METADATA_POSTAGE)
                        : 0,
                ),
                address: changeAddress,
            })
            .change(changeAddress, feeRate)
            .seal();
        return commitTxPsbt;
    }

    static buildRevealTx(
        commitUtxo: UTXO,
        metadata: OpenMinterCat721Meta,
        initMerkleRoot: ByteString,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
    ): {
        collectionId: string;
        minterAddr: string;
        nftAddr: string;
        revealPsbt: ExtPsbt;
        minter: CAT721OpenMinterCovenant;
    } {
        if (!metadata.preminerAddr && metadata.premine > 0) {
            metadata.preminerAddr = Ripemd160(toTokenAddress(address));
        }

        const minter = new CAT721OpenMinterCovenant(`${commitUtxo.txId}_0`, metadata);

        const nft = new CAT721Covenant(minter.address);

        minter.state = {
            nftScript: nft.lockingScriptHex,
            merkleRoot: initMerkleRoot,
            nextLocalId: 0n,
        };

        const commitScript = getCatCollectionCommitScript(catToXOnly(pubkey, isP2TR(address)), metadata);
        const commitLockingScript = Buffer.from(commitScript, 'hex');
        const { cblock } = scriptToP2tr(commitLockingScript);

        const revealTx = new ExtPsbt()
            .addCovenantOutput(minter, Postage.MINTER_POSTAGE)
            .addInput({
                hash: commitUtxo.txId,
                index: 0,
                witnessUtxo: {
                    script: hexToUint8Array(commitUtxo.script),
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
                    const sig = self.getSig(inputIdx, {
                        address: address,
                        disableTweakSigner: isP2TR(address) ? false : true,
                    });
                    const witness = [...self.getTxoStateHashes(), sig, uint8ArrayToHex(commitLockingScript), cblock];
                    return witness.map(hexToUint8Array);
                },
            })
            .spendUTXO(feeUtxos)
            .seal();
        // NOTE: can not have a fee change output here due to the protocol
        minter.bindToUtxo(revealTx.getStatefulCovenantUtxo(1));
        return {
            collectionId: `${commitUtxo.txId}_0`,
            minterAddr: minter.address,
            nftAddr: nft.address,
            revealPsbt: revealTx,
            minter,
        };
    }

    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinter: CAT721OpenMinterCovenant,
        nftReceiver: Ripemd160,
        commitLockingScript: Uint8Array,
        cblock: Uint8Array,
        commitUtxo: UTXO,
        proof: MerkleProof,
        proofNodePos: ProofNodePos,
        nextMerkleRoot: string,
        feeUtxos: UTXO[],
        feeRate: number,
        changeAddress: string,
        preminterAddress: string,
        preminerPubKey: string,
    ) {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }

        const mintTx = new ExtPsbt();

        const { nextMinter } = spentMinter.createNextMinter(nextMerkleRoot);

        // add next minters outputs
        mintTx.addCovenantOutput(nextMinter, Postage.MINTER_POSTAGE);

        const nft = spentMinter.createCAT721(nftReceiver);

        mintTx
            // add token output
            .addCovenantOutput(nft, Postage.TOKEN_POSTAGE)
            // add minter input
            .addCovenantInput(spentMinter)
            //
            .addInput({
                hash: commitUtxo.txId,
                index: commitUtxo.outputIndex,
                witnessUtxo: {
                    script: Buffer.from(commitUtxo.script, 'hex'),
                    value: BigInt(commitUtxo.satoshis),
                },
                tapLeafScript: [
                    {
                        leafVersion: LEAF_VERSION_TAPSCRIPT,
                        script: commitLockingScript,
                        controlBlock: cblock,
                    },
                ],
                finalizer: (self, inputIdx) => {
                    const sig = self.getSig(inputIdx, {
                        address: changeAddress,
                        disableTweakSigner: isP2TR(changeAddress) ? false : true,
                    });
                    return [hexToUint8Array(sig), commitLockingScript, cblock];
                },
            })
            // add fees
            .spendUTXO(feeUtxos)
            // add change output
            .change(changeAddress, feeRate);

        const minterInputIndex = 0;

        const backTraceInfo = getBackTraceInfo(spentMinterTxHex, spentMinterPreTxHex, minterInputIndex);

        mintTx.updateCovenantInput(minterInputIndex, spentMinter, {
            invokeMethod: (contract: CAT721OpenMinter, curPsbt: ExtPsbt) => {
                contract.mint(
                    nft.state,
                    proof,
                    proofNodePos,
                    isP2TR(preminterAddress) ? '' : pubKeyPrefix(preminerPubKey),
                    PubKey(toXOnly(preminerPubKey, isP2TR(preminterAddress))),
                    curPsbt.getSig(minterInputIndex, {
                        publicKey: preminerPubKey,
                    }),
                    satoshiToHex(BigInt(Postage.MINTER_POSTAGE)),
                    satoshiToHex(BigInt(Postage.TOKEN_POSTAGE)),
                    backTraceInfo,
                );
            },
        });

        mintTx.seal();
        nextMinter.bindToUtxo(mintTx.getStatefulCovenantUtxo(1));
        return {
            mintTx,
            minterUtxo: {
                ...mintTx.getStatefulCovenantUtxo(1),
                state: nextMinter.state,
            },
            cat721Utxo: {
                ...mintTx.getStatefulCovenantUtxo(2),
                state: nft.state,
            },
            nextMinter,
        };
    }

    private createNextMinter(nextMerkleRoot: string): {
        nextMinter: CAT721OpenMinterCovenant;
    } {
        const newState: CAT721OpenMinterState = {
            nftScript: this.state.nftScript,
            merkleRoot: nextMerkleRoot,
            nextLocalId: this.state.nextLocalId + 1n,
        };
        return {
            nextMinter: this.next(newState) as CAT721OpenMinterCovenant,
        };
    }

    private createCAT721(toAddr: Ripemd160): CAT721Covenant {
        const contract = this.getSubContract() as CAT721OpenMinter;
        const localId = this.state.nextLocalId;
        let receiverAddr = toAddr;
        if (contract.premine > 0n && this.state.nextLocalId < contract.premine) {
            receiverAddr = this.metadata.preminerAddr;
        }
        return new CAT721Covenant(this.address, { localId, ownerAddr: receiverAddr });
    }

    static updateMerkleTree(collectionMerkleTree: CAT721OpenMinterMerkleTreeData, max: Int32, nextLocalId: Int32) {
        for (let i = 0n; i < max; i++) {
            if (i < nextLocalId) {
                const oldLeaf = collectionMerkleTree.getLeaf(Number(i));
                const newLeaf: CAT721MerkleLeaf = {
                    commitScript: oldLeaf.commitScript,
                    localId: oldLeaf.localId,
                    isMined: true,
                };
                collectionMerkleTree.updateLeaf(newLeaf, Number(i));
            }
        }
    }

    static utxoFromMintTx(
        txHex: string,
        outputIndex: number,
        max: Int32,
        collectionMerkleTree: CAT721OpenMinterMerkleTreeData,
    ): CAT721OpenMinterUtxo {
        const tx = Transaction.fromHex(txHex);
        const minterOutput = tx.outs[outputIndex];
        if (!minterOutput) {
            throw new Error(`Output[${outputIndex}] not found in transaction`);
        }
        const witness = tx.ins[0].witness;
        const witnessHexList = witness.map((v) => uint8ArrayToHex(v));

        const nftScript = witnessHexList[82];
        // const merkleRoot = witnessHexList[83];
        const nextLocalId = byteStringToBigInt(witnessHexList[84]) + 1n;
        const txoStateHashes = witnessHexList.slice(witnessHexList.length - 20 - 5, witnessHexList.length - 20);

        CAT721OpenMinterCovenant.updateMerkleTree(collectionMerkleTree, max, nextLocalId);

        const state: CAT721OpenMinterState = {
            nftScript: nftScript,
            merkleRoot: collectionMerkleTree.merkleRoot,
            nextLocalId: nextLocalId,
        };

        const out = tx.outs[outputIndex];
        const cat721MinterUtxo: CAT721OpenMinterUtxo = {
            txId: tx.getId(),
            outputIndex: outputIndex,
            script: uint8ArrayToHex(out.script),
            satoshis: Number(out.value),
            txHashPreimage: uint8ArrayToHex(tx.toBuffer(undefined, 0, false)),
            txoStateHashes: txoStateHashes as StateHashes,
            state: state,
        };
        return cat721MinterUtxo;
    }
}

// export function pubKeyPrefix(pubKeyHex: string): string {
//     const pubKey = Buffer.from(pubKeyHex, 'hex');
//     if (pubKey.length !== 33) {
//         throw new Error('invalid pubkey');
//     }
//     return pubKey.subarray(0, 1).toString('hex');
// }
