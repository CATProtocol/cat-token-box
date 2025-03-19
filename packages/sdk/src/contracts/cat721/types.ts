import { FixedArray, Int32, NFT_GUARD_COLLECTION_TYPE_MAX, TX_INPUT_COUNT_MAX } from '@scrypt-inc/scrypt-ts-btc';
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
    nftBurnMasks: FixedArray<boolean, typeof TX_INPUT_COUNT_MAX>;
    nftScriptIndexes: FixedArray<Int32, typeof TX_INPUT_COUNT_MAX>;
};

export type CAT721ClosedMinterState = {
    nftScript: ByteString;
    // before the first-time mint, maxLocalId - nextLocalId = nft max supply
    maxLocalId: Int32;
    nextLocalId: Int32;
};
