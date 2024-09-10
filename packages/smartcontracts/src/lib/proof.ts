import BufferReader from 'bitcore-lib-inquisition/lib/encoding/bufferreader'
import {
    FixedArray,
    byteString2Int,
    fill,
    int2ByteString,
    toByteString,
    toHex,
} from 'scrypt-ts'
import * as varuint from 'varuint-bitcoin'
import {
    MAX_INPUT,
    MAX_TOKEN_OUTPUT,
    XRAYED_TXID_PREIMG3_OUTPUT_NUMBER,
} from '../contracts/utils/txUtil'
import {
    TxIdPreimg,
    TxInput,
    XrayedTxIdPreimg1,
    XrayedTxIdPreimg2,
    XrayedTxIdPreimg3,
} from '../contracts/utils/txProof'
import { BacktraceInfo } from '../contracts/utils/backtrace'

const emptyString = toByteString('')

export const emptyFixedArray = function () {
    return fill(emptyString, MAX_INPUT)
}

export const emptyTokenArray = function () {
    return fill(emptyString, MAX_TOKEN_OUTPUT)
}

export const emptyBigIntArray = function () {
    return fill(0n, MAX_INPUT)
}

export const emptyTokenAmountArray = function () {
    return fill(0n, MAX_TOKEN_OUTPUT)
}

export const intArrayToByteString = function (
    array: FixedArray<bigint, typeof MAX_INPUT>
) {
    const rList = emptyFixedArray()
    for (let index = 0; index < array.length; index++) {
        const element = array[index]
        rList[index] = int2ByteString(element)
    }
    return rList
}

export const tokenAmountToByteString = function (
    array: FixedArray<bigint, typeof MAX_TOKEN_OUTPUT>
) {
    const rList = emptyTokenArray()
    for (let index = 0; index < array.length; index++) {
        const element = array[index]
        rList[index] = int2ByteString(element)
    }
    return rList
}

export const txToTxHeader = function (tx): TxIdPreimg {
    const headerReader = BufferReader(tx.toBuffer(true))
    const version = headerReader.read(4)
    const inputNumber = headerReader.readVarintNum()
    const inputTxhashList = emptyFixedArray()
    const inputOutputIndexList = emptyFixedArray()
    const inputScriptList = emptyFixedArray()
    const inputSequenceList = emptyFixedArray()
    for (let index = 0; index < inputNumber; index++) {
        const txhash = headerReader.read(32)
        const outputIndex = headerReader.read(4)
        const unlockScript = headerReader.readVarLengthBuffer()
        if (unlockScript.length > 0) {
            throw Error(`input ${index} unlocking script need eq 0`)
        }
        const sequence = headerReader.read(4)
        inputTxhashList[index] = toHex(txhash)
        inputOutputIndexList[index] = toHex(outputIndex)
        inputScriptList[index] = toByteString('00')
        inputSequenceList[index] = toHex(sequence)
    }
    const outputNumber = headerReader.readVarintNum()
    const outputSatoshisList = emptyFixedArray()
    const outputScriptLenList = emptyFixedArray()
    const outputScriptList = emptyFixedArray()
    for (let index = 0; index < outputNumber; index++) {
        const satoshiBytes = headerReader.read(8)
        const scriptLen = headerReader.readVarintNum()
        const script = headerReader.read(scriptLen)
        outputSatoshisList[index] = toHex(satoshiBytes)
        outputScriptLenList[index] = toHex(varuint.encode(scriptLen))
        outputScriptList[index] = toHex(script)
    }
    const nLocktime = headerReader.read(4)
    return {
        version: toHex(version),
        inputCount: toHex(varuint.encode(inputNumber)),
        inputTxhashList: inputTxhashList,
        inputOutputIndexList: inputOutputIndexList,
        inputScriptList: inputScriptList,
        inputSequenceList: inputSequenceList,
        outputCount: toHex(varuint.encode(outputNumber)),
        outputSatoshisList: outputSatoshisList,
        outputScriptLenList: outputScriptLenList,
        outputScriptList: outputScriptList,
        nLocktime: toHex(nLocktime),
    }
}

export const txToTxHeaderPartial = function (
    txHeader: TxIdPreimg
): XrayedTxIdPreimg1 {
    const inputs = emptyFixedArray()
    for (let index = 0; index < inputs.length; index++) {
        inputs[index] =
            txHeader.inputTxhashList[index] +
            txHeader.inputOutputIndexList[index] +
            txHeader.inputScriptList[index] +
            txHeader.inputSequenceList[index]
    }
    const outputSatoshisList = emptyFixedArray()
    const outputScriptList = emptyFixedArray()
    for (let index = 0; index < outputSatoshisList.length; index++) {
        outputSatoshisList[index] = txHeader.outputSatoshisList[index]
        outputScriptList[index] = txHeader.outputScriptList[index]
    }
    return {
        version: txHeader.version,
        inputCount: txHeader.inputCount,
        inputs: inputs,
        outputCountVal: byteString2Int(txHeader.outputCount),
        outputCount: txHeader.outputCount,
        outputSatoshisList: outputSatoshisList,
        outputScriptList: outputScriptList,
        nLocktime: txHeader.nLocktime,
    }
}

export const txToTxHeaderTiny = function (
    txHeader: TxIdPreimg
): XrayedTxIdPreimg2 {
    let inputString = toByteString('')
    const inputs = emptyFixedArray()
    for (let index = 0; index < inputs.length; index++) {
        // inputs[index] =
        inputString +=
            txHeader.inputTxhashList[index] +
            txHeader.inputOutputIndexList[index] +
            txHeader.inputScriptList[index] +
            txHeader.inputSequenceList[index]
    }
    const prevList = fill(emptyString, 4)
    const _prevList =
        txHeader.version +
        txHeader.inputCount +
        inputString +
        txHeader.outputCount
    for (let index = 0; index < 4; index++) {
        const start = index * 80 * 2
        const end = start + 80 * 2
        prevList[index] = _prevList.slice(start, end)
    }
    const outputSatoshisList = emptyFixedArray()
    const outputScriptList = emptyFixedArray()
    for (let index = 0; index < outputSatoshisList.length; index++) {
        outputSatoshisList[index] = txHeader.outputSatoshisList[index]
        outputScriptList[index] = txHeader.outputScriptList[index]
    }
    return {
        prevList: prevList,
        outputCountVal: byteString2Int(txHeader.outputCount),
        outputCount: txHeader.outputCount,
        outputSatoshisList,
        outputScriptList,
        nLocktime: txHeader.nLocktime,
    }
}

export const txToTxHeaderCheck = function (
    txHeader: TxIdPreimg
): XrayedTxIdPreimg3 {
    let inputString = toByteString('')
    const inputs = emptyFixedArray()
    for (let index = 0; index < inputs.length; index++) {
        inputString +=
            txHeader.inputTxhashList[index] +
            txHeader.inputOutputIndexList[index] +
            txHeader.inputScriptList[index] +
            txHeader.inputSequenceList[index]
    }
    const outputSatoshisList = fill(
        emptyString,
        XRAYED_TXID_PREIMG3_OUTPUT_NUMBER
    )
    const outputScriptList = fill(
        emptyString,
        XRAYED_TXID_PREIMG3_OUTPUT_NUMBER
    )
    for (let index = 0; index < outputSatoshisList.length; index++) {
        outputSatoshisList[index] = txHeader.outputSatoshisList[index]
        outputScriptList[index] = txHeader.outputScriptList[index]
    }
    return {
        prev:
            txHeader.version +
            txHeader.inputCount +
            inputString +
            txHeader.outputCount,
        outputCountVal: byteString2Int(txHeader.outputCount),
        outputCount: txHeader.outputCount,
        outputSatoshisList,
        outputScriptList: outputScriptList,
        nLocktime: txHeader.nLocktime,
    }
}

export const getTxHeaderCheck = function (tx, outputIndex: number) {
    const txHeader = txToTxHeader(tx)
    const outputBuf = Buffer.alloc(4, 0)
    outputBuf.writeUInt32LE(outputIndex)
    return {
        tx: txToTxHeaderCheck(txHeader),
        outputBytes: outputBuf.toString('hex'),
        outputIndex: BigInt(outputIndex),
        outputPre:
            txHeader.outputSatoshisList[outputIndex] +
            txHeader.outputScriptLenList[outputIndex],
    }
}

export const getBackTraceInfo = function (
    preTx,
    prePreTx,
    inputIndex: number
): BacktraceInfo {
    const preTxHeader = txToTxHeader(preTx)
    const prePreTxHeader = txToTxHeader(prePreTx)
    const preTxHeaderPartial = txToTxHeaderPartial(preTxHeader)
    const prePreTxHeaderTiny = txToTxHeaderTiny(prePreTxHeader)
    const preTxInput: TxInput = {
        txhash: preTxHeader.inputTxhashList[inputIndex],
        outputIndex: preTxHeader.inputOutputIndexList[inputIndex],
        outputIndexVal: byteString2Int(
            preTxHeader.inputOutputIndexList[inputIndex]
        ),
        sequence: preTxHeader.inputSequenceList[inputIndex],
    }
    return {
        preTx: preTxHeaderPartial,
        preTxInput: preTxInput,
        preTxInputIndex: BigInt(inputIndex),
        prePreTx: prePreTxHeaderTiny,
    }
}

export const getBackTraceInfoSearch = function (
    preTx,
    prePreTx,
    script: string,
    minterScript?: string
): BacktraceInfo {
    let inputNumber = -1
    for (let index = 0; index < preTx.inputs.length; index++) {
        const preTxInput = preTx.inputs[index]
        const preScript = preTxInput.output.script.toBuffer().toString('hex')
        if (preScript == script || preScript == minterScript) {
            inputNumber = index
            break
        }
    }
    if (inputNumber == -1) {
        throw new Error('not find prev')
    }
    const preTxHeader = txToTxHeader(preTx)
    const prePreTxHeader = txToTxHeader(prePreTx)
    const preTxHeaderPartial = txToTxHeaderPartial(preTxHeader)
    const prePreTxHeaderTiny = txToTxHeaderTiny(prePreTxHeader)
    const preTxInput: TxInput = {
        txhash: preTxHeader.inputTxhashList[inputNumber],
        outputIndex: preTxHeader.inputOutputIndexList[inputNumber],
        outputIndexVal: byteString2Int(
            preTxHeader.inputOutputIndexList[inputNumber]
        ),
        sequence: preTxHeader.inputSequenceList[inputNumber],
    }
    return {
        preTx: preTxHeaderPartial,
        preTxInput: preTxInput,
        preTxInputIndex: BigInt(inputNumber),
        prePreTx: prePreTxHeaderTiny,
    }
}
