import { ByteString, SmartContractLib, assert, hash256, int2ByteString, len, method } from 'scrypt-ts';
import { TxUtils } from './txUtils';
import {
    TX_INPUT_COUNT_BYTE_LEN,
    TX_LOCKTIME_BYTE_LEN,
    TX_OUTPUT_COUNT_BYTE_LEN,
    TX_OUTPUT_COUNT_MAX,
    TX_SEGWIT_INPUT_BYTE_LEN,
    TX_VERSION_BYTE_LEN,
    TX_INPUT_COUNT_MAX,
} from '../constants';
import { TxHashPreimage1, TxHashPreimage2, TxHashPreimage3 } from '../types';

export class TxProof extends SmartContractLib {
    /**
     * Calculate tx hash from TxHashPreimage1
     * @param preimage TxHashPreimage1
     * @returns tx hash
     */
    @method()
    static getTxHashFromPreimage1(preimage: TxHashPreimage1): ByteString {
        // append version, the number of inputs, inputs, and the number of outputs
        assert(len(preimage.version) == TX_VERSION_BYTE_LEN);
        let txRaw =
            preimage.version +
            int2ByteString(preimage.inputCountVal) +
            preimage.inputList[0] +
            preimage.inputList[1] +
            preimage.inputList[2] +
            preimage.inputList[3] +
            preimage.inputList[4] +
            preimage.inputList[5] +
            int2ByteString(preimage.outputCountVal);
        let expectedLen = TX_VERSION_BYTE_LEN + TX_INPUT_COUNT_BYTE_LEN + TX_OUTPUT_COUNT_BYTE_LEN;
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            // there must be no empty element between inputs in the array
            if (i < preimage.inputCountVal) {
                expectedLen += TX_SEGWIT_INPUT_BYTE_LEN;
                assert(len(preimage.inputList[i]) == TX_SEGWIT_INPUT_BYTE_LEN);
            } else {
                assert(len(preimage.inputList[i]) == 0n);
            }
        }
        assert(len(txRaw) == expectedLen);
        // append outputs
        for (let i = 0; i < TX_OUTPUT_COUNT_MAX; i++) {
            const script = preimage.outputScriptList[i];
            const satoshis = preimage.outputSatoshisList[i];
            if (i < preimage.outputCountVal) {
                txRaw += TxUtils.buildOutput(script, satoshis);
            } else {
                assert(len(script) == 0n);
                assert(len(satoshis) == 0n);
            }
        }
        // append locktime and return the tx hash
        assert(len(preimage.locktime) == TX_LOCKTIME_BYTE_LEN);
        return hash256(txRaw + preimage.locktime);
    }

    /**
     * Calculate tx hash from TxHashPreimage2
     * @param preimage TxHashPreimage2
     * @returns tx hash
     */
    @method()
    static getTxHashFromPreimage2(preimage: TxHashPreimage2): ByteString {
        // build suffix, including outputs except for the first output, and lock time
        const suffix = preimage.suffixList[0] + preimage.suffixList[1] + preimage.suffixList[2];
        // build prefix, including version, the number of inputs, inputs, and the number of outputs
        assert(len(preimage.version) == TX_VERSION_BYTE_LEN);
        const prefix =
            preimage.version +
            int2ByteString(preimage.inputCountVal) +
            preimage.inputList[0] +
            preimage.inputList[1] +
            preimage.inputList[2] +
            preimage.inputList[3] +
            preimage.inputList[4] +
            preimage.inputList[5] +
            int2ByteString(preimage.outputCountVal);
        let expectedLen = TX_VERSION_BYTE_LEN + TX_INPUT_COUNT_BYTE_LEN + TX_OUTPUT_COUNT_BYTE_LEN;
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            if (i < preimage.inputCountVal) {
                expectedLen += TX_SEGWIT_INPUT_BYTE_LEN;
                assert(len(preimage.inputList[i]) == TX_SEGWIT_INPUT_BYTE_LEN);
            } else {
                assert(len(preimage.inputList[i]) == 0n);
            }
        }
        assert(len(prefix) == expectedLen);
        // build state hash root output
        const hashRootOutput = TxUtils.buildStateHashRootOutput(preimage.hashRoot);
        // build raw tx and return the tx hash
        return hash256(prefix + hashRootOutput + suffix);
    }

    /**
     * Calculate tx hash from TxHashPreimage3
     * @param preimage TxHashPreimage3
     * @returns tx hash
     */
    @method()
    static getTxHashFromPreimage3(preimage: TxHashPreimage3): ByteString {
        // build suffix, including outputs except for the first output, and lock time
        const suffix = preimage.suffixList[0] + preimage.suffixList[1] + preimage.suffixList[2];
        // build prefix, including version, the number of inputs, inputs, and the number of outputs
        assert(len(preimage.version) == TX_VERSION_BYTE_LEN);
        const prefix =
            preimage.version +
            int2ByteString(preimage.inputCountVal) +
            preimage.inputList[0] +
            preimage.inputList[1] +
            preimage.inputList[2] +
            preimage.inputList[3] +
            int2ByteString(preimage.outputCountVal);
        let expectedLen = TX_VERSION_BYTE_LEN + TX_INPUT_COUNT_BYTE_LEN + TX_OUTPUT_COUNT_BYTE_LEN;
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            if (i < preimage.inputCountVal) {
                expectedLen += TX_SEGWIT_INPUT_BYTE_LEN;
            }
        }
        assert(len(prefix) == expectedLen);
        // build state hash root output
        const hashRootOutput = TxUtils.buildStateHashRootOutput(preimage.hashRoot);
        // build raw tx and return the tx hash
        return hash256(prefix + hashRootOutput + suffix);
    }
}
