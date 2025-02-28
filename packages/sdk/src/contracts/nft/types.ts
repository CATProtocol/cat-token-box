import { ByteString, FixedArray } from 'scrypt-ts';
import { int32, TxHashPreimage3, StateHashes } from '../types';
import { NFT_GUARD_COLLECTION_TYPE_MAX, TX_INPUT_COUNT_MAX } from '../constants';

export type NftGuardInfo = {
    // guard input index in curTx
    inputIndexVal: int32;
    // guard prevTx
    prevTxPreimage: TxHashPreimage3;
    prevOutputIndex: ByteString;
    prevOutputIndexVal: int32;
    // guard state
    curState: NftGuardConstState;
    curStateHashes: StateHashes;
};

export type CAT721State = {
    // owner address
    ownerAddr: ByteString;
    // token index
    localId: int32;
};

export type NftGuardConstState = {
    inputStateHashes: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    nftScripts: FixedArray<ByteString, typeof NFT_GUARD_COLLECTION_TYPE_MAX>;
    // for each input of curTx
    // if the input is an nft and it will be burned, then the value is true
    // otherwise, the value is false by default
    nftBurnMasks: FixedArray<boolean, typeof TX_INPUT_COUNT_MAX>;
    nftScriptIndexes: FixedArray<int32, typeof TX_INPUT_COUNT_MAX>;
};

export const HEIGHT = 15;

export type MerkleProof = FixedArray<ByteString, typeof HEIGHT>;
// to indicate whether the node in merkle proof is on the left or right
// if the node is on the right, then the value is true
// otherwise, the value is false
export type ProofNodePos = FixedArray<boolean, typeof HEIGHT>;

export type NftOpenMinterState = {
    // nft script
    nftScript: ByteString;
    // init merkle root
    merkleRoot: ByteString;
    // next mint local id
    nextLocalId: int32;
};

export type NftClosedMinterState = {
    nftScript: ByteString;
    // before the first-time mint, maxLocalId - nextLocalId = nft max supply
    maxLocalId: int32;
    nextLocalId: int32;
};

export type NftMerkleLeaf = {
    // commit script of this nft
    commitScript: ByteString;
    localId: int32;
    // a flag to indicate whether this nft is mined
    isMined: boolean;
};

export type NftParallelClosedMinterState = {
    nftScript: ByteString;
    nextLocalId: int32;
};
