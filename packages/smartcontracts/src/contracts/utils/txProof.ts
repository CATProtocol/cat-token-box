import {
    ByteString,
    FixedArray,
    SmartContractLib,
    assert,
    hash256,
    int2ByteString,
    len,
    method,
    toByteString,
} from 'scrypt-ts'
import {
    MAX_INPUT,
    MAX_OUTPUT,
    XRAYED_TXID_PREIMG2_PREVLIST_LEN,
    XRAYED_TXID_PREIMG3_OUTPUT_NUMBER,
    int32,
} from './txUtil'

export type TxInput = {
    txhash: ByteString
    outputIndex: ByteString
    outputIndexVal: int32
    sequence: ByteString
}

export type TxIdPreimg = {
    version: ByteString
    inputCount: ByteString
    inputTxhashList: FixedArray<ByteString, typeof MAX_INPUT>
    inputOutputIndexList: FixedArray<ByteString, typeof MAX_INPUT>
    inputScriptList: FixedArray<ByteString, typeof MAX_INPUT>
    inputSequenceList: FixedArray<ByteString, typeof MAX_INPUT>
    outputCount: ByteString
    outputSatoshisList: FixedArray<ByteString, typeof MAX_OUTPUT>
    outputScriptLenList: FixedArray<ByteString, typeof MAX_OUTPUT>
    outputScriptList: FixedArray<ByteString, typeof MAX_OUTPUT>
    nLocktime: ByteString
}

// btc tx v2 calc txid data
// for preTx, check
export type XrayedTxIdPreimg1 = {
    //
    version: ByteString
    // input
    inputCount: ByteString
    inputs: FixedArray<ByteString, typeof MAX_INPUT>
    // outputs
    outputCountVal: int32
    outputCount: ByteString
    outputSatoshisList: FixedArray<ByteString, typeof MAX_OUTPUT>
    outputScriptList: FixedArray<ByteString, typeof MAX_OUTPUT>
    //
    nLocktime: ByteString
}

// for prePreTx, only check output script
export type XrayedTxIdPreimg2 = {
    // version + inputNumberBytes + inputs / 80
    prevList: FixedArray<ByteString, typeof XRAYED_TXID_PREIMG2_PREVLIST_LEN>
    // outputs
    outputCountVal: int32
    outputCount: ByteString
    outputSatoshisList: FixedArray<ByteString, typeof MAX_OUTPUT>
    outputScriptList: FixedArray<ByteString, typeof MAX_OUTPUT>
    nLocktime: ByteString
}

// for amountCheckTx
export type XrayedTxIdPreimg3 = {
    /*
        (version inputNumberBytes inputs outputNumberBytes) = pre
        element size less than 80, so only support 1 input
        len() = 47
    */
    prev: ByteString
    outputCountVal: int32
    outputCount: ByteString
    outputSatoshisList: FixedArray<
        ByteString,
        typeof XRAYED_TXID_PREIMG3_OUTPUT_NUMBER
    >
    outputScriptList: FixedArray<
        ByteString,
        typeof XRAYED_TXID_PREIMG3_OUTPUT_NUMBER
    >
    nLocktime: ByteString
}

export class TxProof extends SmartContractLib {
    @method()
    static getTxIdFromPreimg1(preimage: XrayedTxIdPreimg1): ByteString {
        let txHex = preimage.version + preimage.inputCount
        for (let i = 0; i < MAX_INPUT; i++) {
            txHex += preimage.inputs[i]
        }
        txHex += preimage.outputCount
        assert(int2ByteString(preimage.outputCountVal) == preimage.outputCount)
        for (let i = 0; i < MAX_OUTPUT; i++) {
            const outputSatoshi = preimage.outputSatoshisList[i]
            const outputScript = preimage.outputScriptList[i]
            const outputScriptLen = int2ByteString(len(outputScript))
            if (i < preimage.outputCountVal) {
                txHex += outputSatoshi + outputScriptLen + outputScript
            }
        }
        return hash256(txHex + preimage.nLocktime)
    }

    @method()
    static getTxIdFromPreimg2(preimage: XrayedTxIdPreimg2): ByteString {
        let txHex = toByteString('')
        for (let i = 0; i < XRAYED_TXID_PREIMG2_PREVLIST_LEN; i++) {
            txHex += preimage.prevList[i]
        }
        assert(int2ByteString(preimage.outputCountVal) == preimage.outputCount)
        for (let i = 0; i < MAX_OUTPUT; i++) {
            const outputSatoshi = preimage.outputSatoshisList[i]
            const outputScript = preimage.outputScriptList[i]
            const outputScriptLen = int2ByteString(len(outputScript))
            if (i < preimage.outputCountVal) {
                txHex += outputSatoshi + outputScriptLen + outputScript
            }
        }
        return hash256(txHex + preimage.nLocktime)
    }

    @method()
    static getTxIdFromPreimg3(preimage: XrayedTxIdPreimg3): ByteString {
        assert(int2ByteString(preimage.outputCountVal) == preimage.outputCount)
        let outputs = toByteString('')
        for (let i = 0; i < XRAYED_TXID_PREIMG3_OUTPUT_NUMBER; i++) {
            const outputSatoshis = preimage.outputSatoshisList[i]
            const outputScript = preimage.outputScriptList[i]
            const outputScriptLen = int2ByteString(len(outputScript))
            if (i < preimage.outputCountVal) {
                outputs += outputSatoshis + outputScriptLen + outputScript
            }
        }
        return hash256(preimage.prev + outputs + preimage.nLocktime)
    }

    @method()
    static mergeInput(txInput: TxInput): ByteString {
        return (
            txInput.txhash +
            txInput.outputIndex +
            toByteString('00') +
            txInput.sequence
        )
    }

    @method()
    static verifyOutput(
        preimage: XrayedTxIdPreimg2,
        txhash: ByteString,
        outputIndexVal: int32,
        outputScript: ByteString
    ): boolean {
        assert(TxProof.getTxIdFromPreimg2(preimage) == txhash)
        assert(
            preimage.outputScriptList[Number(outputIndexVal)] == outputScript
        )
        return true
    }
}
