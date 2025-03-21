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
