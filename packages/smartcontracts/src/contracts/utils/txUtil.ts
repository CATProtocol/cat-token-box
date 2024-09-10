import {
    method,
    toByteString,
    ByteString,
    SmartContractLib,
    FixedArray,
    len,
    int2ByteString,
    prop,
    assert,
} from 'scrypt-ts'
import { SpentScriptsCtx } from './sigHashUtils'

export type int32 = bigint
export const Int32 = BigInt

export type TxOutpoint = {
    txhash: ByteString
    outputIndex: ByteString
}

export type LockingScriptParts = {
    code: ByteString
    data: ByteString
}

export type OpPushData = {
    len: int32
    value: int32
}

export type VarIntData = {
    len: int32
    value: int32
}

export type ChangeInfo = {
    script: ByteString
    satoshis: ByteString
}

/*
Because of bvm stack max element size is 520, witness tx calculate txid data need less than 520.
so max input number is 6, and output number is 6.
version 4
inputNumber 1
input (32 + 4 + 1 + 4) * inputNumber
outputNumber 1
output (8 + 1 + 34(p2tr script size)) * outputNumber
nLocktime 4
(520 - (4 + 1 + 1 + 4)) / (41 + 43) = 6.07
*/
// tx max input number
export const MAX_INPUT = 6
// tx max ouput number
export const MAX_OUTPUT = 6
// tx max token input number
export const MAX_TOKEN_INPUT = 5
// tx max token output number
export const MAX_TOKEN_OUTPUT = 5
// tx max stated output number, same as token output number
export const MAX_STATE = 5
// cat20 address len
export const ADDRESS_HASH_LEN = 20n
// state output index
export const STATE_OUTPUT_INDEX = 0
// other output start from 1
export const STATE_OUTPUT_OFFSET = 1
// max output script len, p2tr = 34
export const MAX_OUTPUT_SCRIPT_LEN = 34
// txid preimg2 prelist length is 4
export const XRAYED_TXID_PREIMG2_PREVLIST_LEN = 4
// txid preimg3 output length is 4
export const XRAYED_TXID_PREIMG3_OUTPUT_NUMBER = 4

export class TxUtil extends SmartContractLib {
    @prop()
    static readonly ZEROSAT: ByteString = toByteString('0000000000000000')

    @method()
    static mergePrevouts(
        prevouts: FixedArray<ByteString, typeof MAX_INPUT>
    ): ByteString {
        let result = toByteString('')
        for (let index = 0; index < MAX_INPUT; index++) {
            const prevout = prevouts[index]
            result += prevout
        }
        return result
    }

    @method()
    static mergeSpentScripts(spentScripts: SpentScriptsCtx): ByteString {
        let result = toByteString('')
        for (let index = 0; index < MAX_INPUT; index++) {
            const spentScript = spentScripts[index]
            result += int2ByteString(len(spentScript)) + spentScript
        }
        return result
    }

    @method()
    static buildOutput(script: ByteString, satoshis: ByteString): ByteString {
        const nlen = len(script)
        assert(nlen <= MAX_OUTPUT_SCRIPT_LEN)
        return satoshis + int2ByteString(nlen) + script
    }

    @method()
    static checkIndex(indexVal: int32, index: ByteString): boolean {
        let indexByte = int2ByteString(indexVal)
        if (indexByte == toByteString('')) {
            indexByte = toByteString('00')
        }
        return indexByte + toByteString('000000') == index
    }

    @method()
    static buildOpReturnRoot(script: ByteString): ByteString {
        return (
            toByteString('0000000000000000') +
            int2ByteString(len(script)) +
            script
        )
    }

    @method()
    static getStateScript(hashRoot: ByteString): ByteString {
        // op_return + 24 + cat + version(01) + hashroot
        return toByteString('6a1863617401') + hashRoot
    }

    @method()
    static getChangeOutput(changeInfo: ChangeInfo): ByteString {
        return changeInfo.satoshis != TxUtil.ZEROSAT
            ? TxUtil.buildOutput(changeInfo.script, changeInfo.satoshis)
            : toByteString('')
    }
}
