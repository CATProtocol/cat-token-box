import { ByteString, FixedArray, PubKey, Sig } from 'scrypt-ts';
import {
    TX_INPUT_COUNT_MAX,
    STATE_OUTPUT_COUNT_MAX,
    TX_OUTPUT_COUNT_MAX,
    TX_HASH_PREIMAGE2_SUFFIX_ARRAY_SIZE,
    TX_HASH_PREIMAGE3_INPUT_ARRAY_SIZE,
    TX_HASH_PREIMAGE3_SUFFIX_ARRAY_SIZE,
} from './constants';

export type int32 = bigint;
export const Int32 = BigInt;

export type TxOutpoint = {
    txHash: ByteString;
    outputIndex: ByteString;
};

export type TxOut = {
    script: ByteString;
    satoshis: ByteString;
};

export type TxIn = {
    prevTxHash: ByteString;
    prevOutputIndex: ByteString;
    prevOutputIndexVal: int32;
    sequence: ByteString;
};

export type TxHashPreimage1 = {
    // version
    version: ByteString;
    // the number of inputs
    inputCountVal: int32;
    // input list, each element represents an individual input
    inputList: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    // the number of outputs
    outputCountVal: int32;
    // output list
    outputSatoshisList: FixedArray<ByteString, typeof TX_OUTPUT_COUNT_MAX>;
    outputScriptList: FixedArray<ByteString, typeof TX_OUTPUT_COUNT_MAX>;
    // locktime
    locktime: ByteString;
};

export type TxHashPreimage2 = {
    // version
    version: ByteString;
    // the number of inputs
    inputCountVal: int32;
    // input list, each element represents an individual input
    inputList: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    // the number of outputs
    outputCountVal: int32;
    // state hash root, used to build the first output
    hashRoot: ByteString;
    // suffixes, including outputs except for the first output, and lock time,
    // elements are split by byte length
    suffixList: FixedArray<ByteString, typeof TX_HASH_PREIMAGE2_SUFFIX_ARRAY_SIZE>;
};

export type TxHashPreimage3 = {
    // version
    version: ByteString;
    // the number of inputs
    inputCountVal: int32;
    // input list, elements are split by byte length,
    // each element does NOT represent an individual input
    inputList: FixedArray<ByteString, typeof TX_HASH_PREIMAGE3_INPUT_ARRAY_SIZE>;
    // the number of outputs
    outputCountVal: int32;
    // state hash root, used to build the first output
    hashRoot: ByteString;
    // suffixes, including outputs except for the first output, and lock time,
    // elements are split by byte length
    suffixList: FixedArray<ByteString, typeof TX_HASH_PREIMAGE3_SUFFIX_ARRAY_SIZE>;
};

export type StateHashes = FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>;

export type InputStateProof = {
    prevTxPreimage: TxHashPreimage3;
    prevOutputIndexVal: int32;
    stateHashes: StateHashes;
};

export type SHPreimage = {
    nVersion: ByteString;
    nLockTime: ByteString;
    shaPrevouts: ByteString;
    shaSpentAmounts: ByteString;
    shaSpentScripts: ByteString;
    shaSequences: ByteString;
    shaOutputs: ByteString;
    spendType: ByteString;
    inputIndex: ByteString;
    tapLeafHash: ByteString;
    keyVersion: ByteString;
    codeSepPos: ByteString;
    e_: ByteString; // e without last byte
    eLastByte: int32;
};

export type Prevouts = FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
export type SpentScriptsCtx = FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
export type SpentAmountsCtx = FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;

export type PrevoutsCtx = {
    inputIndexVal: int32;
    prevouts: Prevouts;
    prevTxHash: ByteString;
    prevOutputIndex: ByteString;
    prevOutputIndexVal: int32;
};

export type BacktraceInfo = {
    // prevTx
    prevTxPreimage: TxHashPreimage2;
    prevTxInput: TxIn;
    prevTxInputIndexVal: int32;
    // prevPrevTx
    prevPrevTxPreimage: TxHashPreimage1;
};

// args to unlock a token UTXO or a nft UTXO
export type ContractUnlockArgs = {
    // true means spend by user, false means spend by contract
    isUserSpend: boolean;
    // user spend args
    userPubKeyPrefix: ByteString;
    userXOnlyPubKey: PubKey;
    userSig: Sig;
    // contract spend arg
    contractInputIndexVal: int32;
};
