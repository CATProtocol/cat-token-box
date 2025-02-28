import { ByteString, FixedArray } from 'scrypt-ts';
import { int32, StateHashes, TxHashPreimage3 } from '../types';
import { TX_INPUT_COUNT_MAX, GUARD_TOKEN_TYPE_MAX } from '../constants';

export type GuardInfo = {
    // guard input index in curTx
    inputIndexVal: int32;
    // guard prevTx
    prevTxPreimage: TxHashPreimage3;
    prevOutputIndex: ByteString;
    prevOutputIndexVal: int32;
    // guard state
    curState: GuardConstState;
    curStateHashes: StateHashes;
};

export type CAT20State = {
    // owner address
    ownerAddr: ByteString;
    // token amount
    amount: int32;
};

export type GuardConstState = {
    // state hash for each input of curTx
    // the input could come from a token output or any other type of contract outputs
    inputStateHashes: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;

    // scripts of all the different types of tokens in curTx inputs
    // e.g.
    // ['token1Script', 'token2Script', 'fd', 'fc']
    // this means there are two different types of tokens in curTx inputs
    // the default placeholders are 'ff', 'fe', 'fd', and 'fc' to ensure the uniqueness of token scripts
    tokenScripts: FixedArray<ByteString, typeof GUARD_TOKEN_TYPE_MAX>;

    // total number of tokens for each type of token in curTx inputs
    // e.g.
    // [100, 200, 0, 0]
    // this means there are a total of 100 token1 and 200 token2 in curTx inputs
    tokenAmounts: FixedArray<int32, typeof GUARD_TOKEN_TYPE_MAX>;
    // total number of tokens to be burned for each type of token in curTx
    // e.g.
    // [0, 50, 0, 0]
    // this means 50 token2 will be burned in curTx
    tokenBurnAmounts: FixedArray<int32, typeof GUARD_TOKEN_TYPE_MAX>;
    // combined the two arrays above
    // the output total number of tokens for each type of token will be
    // token1: 100
    // token2: 150

    // for each input of curTx
    // if the input is a token, the value marks the index of the token script in the tokenScripts array
    // otherwise, the value is -1 by default
    // e.g.
    // [-1, 0, 1, 1, 0, -1]
    // this means
    // the input #0 and #5 is not a token contract
    // the input #1 and #4 is a token contract with script tokenScripts[0] = 'token1Script'
    // the input #2 and #3 is a token contract with script tokenScripts[1] = 'token2Script'
    tokenScriptIndexes: FixedArray<int32, typeof TX_INPUT_COUNT_MAX>;
};

export const MAX_NEXT_MINTERS = 2;

export type OpenMinterState = {
    // token script
    tokenScript: ByteString;
    // first-time mint flag
    hasMintedBefore: boolean;
    // remaining mint count
    remainingCount: int32;
};

export type ClosedMinterState = {
    tokenScript: ByteString;
};
