import { Bool, FixedArray, Int32, NFT_GUARD_COLLECTION_TYPE_MAX, TX_INPUT_COUNT_MAX } from '@scrypt-inc/scrypt-ts-btc';
import { ByteString } from '@scrypt-inc/scrypt-ts-btc';

export type CAT721State = {
    // owner address
    ownerAddr: ByteString;
    // token index
    localId: Int32;
};

export type CAT721GuardConstState = {
    inputStateHashes: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    nftScripts: FixedArray<ByteString, typeof NFT_GUARD_COLLECTION_TYPE_MAX>;
    // for each input of curTx
    // if the input is an nft and it will be burned, then the value is true
    // otherwise, the value is false by default
    nftBurnMasks: FixedArray<Bool, typeof TX_INPUT_COUNT_MAX>;
    nftScriptIndexes: FixedArray<Int32, typeof TX_INPUT_COUNT_MAX>;
};

export type CAT721ClosedMinterState = {
    nftScript: ByteString;
    // before the first-time mint, maxLocalId - nextLocalId = nft max supply
    maxLocalId: Int32;
    nextLocalId: Int32;
};

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

export type CAT721OpenMinterState = {
    // nft script
    nftScript: ByteString;
    // init merkle root
    merkleRoot: ByteString;
    // next mint local id
    nextLocalId: Int32;
};

export type CAT721ParallelClosedMinterState = {
    nftScript: ByteString;
    nextLocalId: Int32;
};
