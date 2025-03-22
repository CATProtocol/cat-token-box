import {
    FixedArray,
    Int32,
    NFT_GUARD_COLLECTION_TYPE_MAX,
    StructObject,
    TX_INPUT_COUNT_MAX,
} from '@scrypt-inc/scrypt-ts-btc';
import { ByteString } from '@scrypt-inc/scrypt-ts-btc';

export interface CAT721State extends StructObject {
    // owner address
    ownerAddr: ByteString;
    // token index
    localId: Int32;
}

export interface CAT721GuardConstState extends StructObject {
    inputStateHashes: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    nftScripts: FixedArray<ByteString, typeof NFT_GUARD_COLLECTION_TYPE_MAX>;
    // for each input of curTx
    // if the input is an nft and it will be burned, then the value is true
    // otherwise, the value is false by default
    nftBurnMasks: FixedArray<boolean, typeof TX_INPUT_COUNT_MAX>;
    nftScriptIndexes: FixedArray<Int32, typeof TX_INPUT_COUNT_MAX>;
}

export interface CAT721ClosedMinterState extends StructObject {
    nftScript: ByteString;
    // before the first-time mint, maxLocalId - nextLocalId = nft max supply
    maxLocalId: Int32;
    nextLocalId: Int32;
}

export const HEIGHT = 15;

export type MerkleProof = FixedArray<ByteString, typeof HEIGHT>;
// to indicate whether the node in merkle proof is on the left or right
// if the node is on the right, then the value is true
// otherwise, the value is false
export type ProofNodePos = FixedArray<boolean, typeof HEIGHT>;

export type CAT721MerkleLeaf = {
    // commit script of this nft
    commitScript: ByteString;
    localId: Int32;
    // a flag to indicate whether this nft is mined
    isMined: boolean;
};

export interface CAT721OpenMinterState extends StructObject {
    // nft script
    nftScript: ByteString;
    // init merkle root
    merkleRoot: ByteString;
    // next mint local id
    nextLocalId: Int32;
}

export interface CAT721ParallelClosedMinterState extends StructObject {
    nftScript: ByteString;
    nextLocalId: Int32;
}
