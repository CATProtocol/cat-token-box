import { ByteString, FixedArray, byteString2Int, fill, hash160, int2ByteString, toByteString, toHex } from 'scrypt-ts';
import * as varuint from 'varuint-bitcoin';
import {
    TX_INPUT_COUNT_MAX,
    TX_OUTPUT_COUNT_MAX,
    STATE_OUTPUT_COUNT_MAX,
    TX_HASH_PREIMAGE2_SUFFIX_ARRAY_SIZE,
    TX_HASH_PREIMAGE3_INPUT_ARRAY_SIZE,
    TX_HASH_PREIMAGE3_SUFFIX_ARRAY_SIZE,
} from '../contracts/constants';
import { InputStateProof, TxIn, TxHashPreimage1, TxHashPreimage2, TxHashPreimage3 } from '../contracts/types';
import { TxUtils } from '../contracts/utils/txUtils';
import { bitcoinjs } from './btc';
import { uint8ArrayToHex } from './utils';
import { BufferReader } from './bufferReader';

export type TxHashPreimage = {
    version: ByteString;
    inputCount: ByteString;
    inputPrevTxHashList: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    inputPrevOutputIndexList: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    inputScriptList: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    inputSequenceList: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>;
    outputCount: ByteString;
    outputSatoshisList: FixedArray<ByteString, typeof TX_OUTPUT_COUNT_MAX>;
    outputScriptLenList: FixedArray<ByteString, typeof TX_OUTPUT_COUNT_MAX>;
    outputScriptList: FixedArray<ByteString, typeof TX_OUTPUT_COUNT_MAX>;
    locktime: ByteString;
};

export const emptyString = toByteString('');

export const emptyFixedArray = function () {
    return fill(emptyString, TX_INPUT_COUNT_MAX);
};

export const emptyTokenArray = function () {
    return fill(emptyString, STATE_OUTPUT_COUNT_MAX);
};

export const emptyOutputByteStrings = function () {
    return fill(emptyString, STATE_OUTPUT_COUNT_MAX);
};

export const emptyBigIntArray = function () {
    return fill(0n, TX_INPUT_COUNT_MAX);
};

export const emptyTokenAmountArray = function () {
    return fill(0n, STATE_OUTPUT_COUNT_MAX);
};

export const intArrayToByteString = function (array: FixedArray<bigint, typeof TX_INPUT_COUNT_MAX>) {
    const rList = emptyFixedArray();
    for (let index = 0; index < array.length; index++) {
        const element = array[index];
        rList[index] = hash160(int2ByteString(element));
    }
    return rList;
};

export const tokenAmountToByteString = function (array: FixedArray<bigint, typeof STATE_OUTPUT_COUNT_MAX>) {
    const rList = emptyTokenArray();
    for (let index = 0; index < array.length; index++) {
        const element = array[index];
        rList[index] = int2ByteString(element);
    }
    return rList;
};

export const txToTxHeader = function (txBuf: Buffer): TxHashPreimage {
    const headerReader = new BufferReader(txBuf);
    const version = uint8ArrayToHex(headerReader.readSlice(4));
    const inputNumber = headerReader.readVarInt();
    const inputTxhashList = emptyFixedArray();
    const inputOutputIndexList = emptyFixedArray();
    const inputScriptList = emptyFixedArray();
    const inputSequenceList = emptyFixedArray();
    for (let index = 0; index < inputNumber; index++) {
        const txhash = uint8ArrayToHex(headerReader.readSlice(32));
        const outputIndex = uint8ArrayToHex(headerReader.readSlice(4));
        const unlockScript = uint8ArrayToHex(headerReader.readVarSlice());
        if (unlockScript.length > 0) {
            throw Error(`input ${index} unlocking script need eq 0`);
        }
        const sequence = uint8ArrayToHex(headerReader.readSlice(4));
        inputTxhashList[index] = toHex(txhash);
        inputOutputIndexList[index] = toHex(outputIndex);
        inputScriptList[index] = toByteString('00');
        inputSequenceList[index] = toHex(sequence);
    }
    const outputNumber = headerReader.readVarInt();
    const outputSatoshisList = emptyFixedArray();
    const outputScriptLenList = emptyFixedArray();
    const outputScriptList = emptyFixedArray();
    for (let index = 0; index < outputNumber; index++) {
        const satoshiBytes = uint8ArrayToHex(headerReader.readSlice(8));
        const scriptLen = headerReader.readVarInt();
        const script = uint8ArrayToHex(headerReader.readSlice(scriptLen));
        outputSatoshisList[index] = toHex(satoshiBytes);
        outputScriptLenList[index] = toHex(varuint.encode(scriptLen));
        outputScriptList[index] = toHex(script);
    }

    const inputCount = toHex(Buffer.from(varuint.encode(inputNumber).buffer));
    const outputCount = toHex(Buffer.from(varuint.encode(outputNumber).buffer));
    const nLocktime = uint8ArrayToHex(headerReader.readSlice(4));
    return {
        version: toHex(version),
        inputCount,
        inputPrevTxHashList: inputTxhashList,
        inputPrevOutputIndexList: inputOutputIndexList,
        inputScriptList: inputScriptList,
        inputSequenceList: inputSequenceList,
        outputCount,
        outputSatoshisList: outputSatoshisList,
        outputScriptLenList: outputScriptLenList,
        outputScriptList: outputScriptList,
        locktime: toHex(nLocktime),
    };
};

export const txToTxHeaderPartial = function (txHeader: TxHashPreimage): TxHashPreimage1 {
    const inputs = emptyFixedArray();
    for (let index = 0; index < inputs.length; index++) {
        inputs[index] =
            txHeader.inputPrevTxHashList[index] +
            txHeader.inputPrevOutputIndexList[index] +
            txHeader.inputScriptList[index] +
            txHeader.inputSequenceList[index];
    }
    const outputSatoshisList = emptyFixedArray();
    const outputScriptList = emptyFixedArray();
    for (let index = 0; index < outputSatoshisList.length; index++) {
        outputSatoshisList[index] = txHeader.outputSatoshisList[index];
        outputScriptList[index] = txHeader.outputScriptList[index];
    }
    return {
        version: txHeader.version,
        inputCountVal: byteString2Int(txHeader.inputCount),
        inputList: inputs,
        outputCountVal: byteString2Int(txHeader.outputCount),
        outputSatoshisList: outputSatoshisList,
        outputScriptList: outputScriptList,
        locktime: txHeader.locktime,
    };
};

export const txToTxHeaderTiny = function (txHeader: TxHashPreimage): TxHashPreimage2 {
    const inputs = emptyFixedArray();
    for (let index = 0; index < inputs.length; index++) {
        // inputs[index] =
        inputs[index] =
            txHeader.inputPrevTxHashList[index] +
            txHeader.inputPrevOutputIndexList[index] +
            txHeader.inputScriptList[index] +
            txHeader.inputSequenceList[index];
    }
    let otherOutputString = toByteString('');
    for (let index = 1; index < TX_OUTPUT_COUNT_MAX; index++) {
        if (txHeader.outputScriptList[index].length > 0) {
            otherOutputString += TxUtils.buildOutput(
                txHeader.outputScriptList[index],
                txHeader.outputSatoshisList[index],
            );
        }
    }
    otherOutputString += txHeader.locktime;
    const suffixList = fill(emptyString, TX_HASH_PREIMAGE2_SUFFIX_ARRAY_SIZE);
    for (let index = 0; index < TX_HASH_PREIMAGE2_SUFFIX_ARRAY_SIZE; index++) {
        const start = index * 80 * 2;
        const end = start + 80 * 2;
        suffixList[index] = otherOutputString.slice(start, end);
    }
    return {
        version: txHeader.version,
        inputCountVal: byteString2Int(txHeader.inputCount),
        inputList: inputs,
        outputCountVal: byteString2Int(txHeader.outputCount),
        hashRoot: txHeader.outputScriptList[0].slice(12),
        suffixList: suffixList,
    };
};

export const txToXrayedTxIdPreimg4 = function (txHeader: TxHashPreimage): TxHashPreimage3 {
    const img2 = txToTxHeaderTiny(txHeader);
    let inputString = toByteString('');
    for (const input of img2.inputList) {
        inputString += input;
    }
    const prefixList = fill(emptyString, TX_HASH_PREIMAGE3_INPUT_ARRAY_SIZE);
    for (let index = 0; index < TX_HASH_PREIMAGE3_INPUT_ARRAY_SIZE; index++) {
        const start = index * 80 * 2;
        const end = start + 80 * 2;
        prefixList[index] = inputString.slice(start, end);
    }
    return {
        version: img2.version,
        inputCountVal: img2.inputCountVal,
        inputList: prefixList,
        outputCountVal: img2.outputCountVal,
        hashRoot: img2.hashRoot,
        suffixList: img2.suffixList,
    };
};

export const createEmptyXrayedTxIdPreimg4 = function (): TxHashPreimage3 {
    return {
        version: emptyString,
        inputCountVal: 0n,
        inputList: fill(emptyString, TX_HASH_PREIMAGE3_INPUT_ARRAY_SIZE),
        outputCountVal: 0n,
        hashRoot: emptyString,
        suffixList: fill(emptyString, TX_HASH_PREIMAGE3_SUFFIX_ARRAY_SIZE),
    };
};

export const createInputStateProofArray = function (): FixedArray<InputStateProof, typeof TX_INPUT_COUNT_MAX> {
    const item: InputStateProof = {
        prevTxPreimage: createEmptyXrayedTxIdPreimg4(),
        prevOutputIndexVal: 0n,
        stateHashes: fill(emptyString, STATE_OUTPUT_COUNT_MAX),
    };
    return fill(item, TX_INPUT_COUNT_MAX);
};

export const getTxHeaderCheck = function (tx, outputIndex: number) {
    const txHeader = txToTxHeader(tx.toBuffer(true));
    const outputBuf = Buffer.alloc(4, 0);
    outputBuf.writeUInt32LE(outputIndex);
    return {
        tx: txToXrayedTxIdPreimg4(txHeader),
        outputBytes: outputBuf.toString('hex'),
        outputIndex: BigInt(outputIndex),
        outputPre: txHeader.outputSatoshisList[outputIndex] + txHeader.outputScriptLenList[outputIndex],
    };
};

export const txHexToXrayedTxIdPreimg4 = function (txHex: string) {
    const tx = bitcoinjs.Transaction.fromHex(txHex);
    const txHeader = txToTxHeader(tx.__toBuffer());
    return txToXrayedTxIdPreimg4(txHeader);
};

export const getBackTraceInfo_ = function (prevTxHex: string, prevPrevTxHex: string, prevTxInputIndex: number) {
    const prevTxHeader = txToTxHeader(bitcoinjs.Transaction.fromHex(prevTxHex).__toBuffer());
    const prevPrevTxHeader = txToTxHeader(bitcoinjs.Transaction.fromHex(prevPrevTxHex).__toBuffer());
    const prevTxHeaderTiny = txToTxHeaderTiny(prevTxHeader);
    const prevPrevTxHeaderPartial = txToTxHeaderPartial(prevPrevTxHeader);
    const prevTxInput: TxIn = {
        prevTxHash: prevTxHeader.inputPrevTxHashList[prevTxInputIndex],
        prevOutputIndex: prevTxHeader.inputPrevOutputIndexList[prevTxInputIndex],
        prevOutputIndexVal: byteString2Int(prevTxHeader.inputPrevOutputIndexList[prevTxInputIndex]),
        sequence: prevTxHeader.inputSequenceList[prevTxInputIndex],
    };
    return {
        prevTxPreimage: prevTxHeaderTiny,
        prevTxInput: prevTxInput,
        prevTxInputIndexVal: BigInt(prevTxInputIndex),
        prevPrevTxPreimage: prevPrevTxHeaderPartial,
    };
};
