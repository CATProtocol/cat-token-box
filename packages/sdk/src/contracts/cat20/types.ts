import { FixedArray, GUARD_TOKEN_TYPE_MAX, Int32, StructObject, TX_INPUT_COUNT_MAX } from '@scrypt-inc/scrypt-ts-btc';
import { ByteString } from '@scrypt-inc/scrypt-ts-btc';

export interface CAT20State extends StructObject {
    // owner address
    ownerAddr: ByteString;
    // token amount
    amount: Int32;
}

export interface CAT20GuardConstState extends StructObject {
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
    tokenAmounts: FixedArray<Int32, typeof GUARD_TOKEN_TYPE_MAX>;
    // total number of tokens to be burned for each type of token in curTx
    // e.g.
    // [0, 50, 0, 0]
    // this means 50 token2 will be burned in curTx
    tokenBurnAmounts: FixedArray<Int32, typeof GUARD_TOKEN_TYPE_MAX>;
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
    tokenScriptIndexes: FixedArray<Int32, typeof TX_INPUT_COUNT_MAX>;
}

export interface CAT20ClosedMinterState extends StructObject {
    tokenScript: ByteString;
}

export interface CAT20OpenMinterState extends StructObject {
    // token script
    tokenScript: ByteString;
    // first-time mint flag
    hasMintedBefore: boolean;
    // remaining mint count
    remainingCount: Int32;
}
