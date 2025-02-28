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
} from 'scrypt-ts';
import { TxOut, int32, SpentAmountsCtx, SpentScriptsCtx, TxIn } from '../types';
import {
    STATE_HASH_ROOT_BYTE_LEN,
    TX_INPUT_COUNT_MAX,
    TX_IO_INDEX_VAL_MAX,
    TX_IO_INDEX_VAL_MIN,
    TX_INPUT_PREV_TX_HASH_BYTE_LEN,
    TX_INPUT_PREVOUT_BYTE_LEN,
    TX_INPUT_SEQUENCE_BYTE_LEN,
    TX_OUTPUT_SATOSHI_BYTE_LEN,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
} from '../constants';

type MergePrevoutsResponse = {
    prevouts: ByteString;
    inputCount: bigint;
};

export class TxUtils extends SmartContractLib {
    @prop()
    static readonly ZERO_SATS: ByteString = toByteString('0000000000000000');

    /**
     * Merge prevout list into a single ByteString
     * @param prevouts prevout list to merge
     * @returns merged prevouts and number of tx inputs
     */
    @method()
    static mergePrevouts(prevouts: FixedArray<ByteString, typeof TX_INPUT_COUNT_MAX>): MergePrevoutsResponse {
        const mergedPrevouts = prevouts[0] + prevouts[1] + prevouts[2] + prevouts[3] + prevouts[4] + prevouts[5];
        let inputCount = 0n;
        const prevoutsLen = len(mergedPrevouts);
        if (prevoutsLen == 36n) {
            inputCount = 1n;
        } else if (prevoutsLen == 72n) {
            inputCount = 2n;
        } else if (prevoutsLen == 108n) {
            inputCount = 3n;
        } else if (prevoutsLen == 144n) {
            inputCount = 4n;
        } else if (prevoutsLen == 180n) {
            inputCount = 5n;
        } else if (prevoutsLen == 216n) {
            inputCount = 6n;
        } else {
            assert(false, 'prevouts invalid length');
        }
        // check there are no empty elements between prevouts in the array
        // correct: [prevout, prevout, prevout, empty, empty, empty]
        // invalid: [prevout, prevout, empty, prevout, empty, empty]
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const prevoutLen = len(prevouts[i]);
            if (i < inputCount) {
                assert(prevoutLen == TX_INPUT_PREVOUT_BYTE_LEN, 'invalid prevout list');
            } else {
                assert(prevoutLen == 0n, 'invalid prevout list');
            }
        }
        return { prevouts: mergedPrevouts, inputCount };
    }

    /**
     * Merge spent script list into a single ByteString
     * @param ctx spent script list to merge
     * @param inputCount the number of tx inputs, must be verified and trusable
     * @returns merged spent scripts
     */
    @method()
    static mergeSpentScripts(ctx: SpentScriptsCtx, inputCount: bigint): ByteString {
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const scriptLen = len(ctx[i]);
            if (i < inputCount) {
                assert(scriptLen > 0n, 'spent script length must be greater than 0');
            } else {
                assert(scriptLen == 0n, 'invalid spent script list');
            }
        }
        let spentScripts = toByteString('');
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const script = ctx[i];
            spentScripts += int2ByteString(len(script)) + script;
        }
        return spentScripts;
    }

    /**
     *  Merge spent amount list into a single ByteString
     * @param ctx spent amount list to merge
     * @param inputCount the number of tx inputs, must be verified and trusable
     * @returns merged spent amounts
     */
    @method()
    static mergeSpentAmounts(ctx: SpentAmountsCtx, inputCount: bigint): ByteString {
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const scriptLen = len(ctx[i]);
            if (i < inputCount) {
                assert(scriptLen == TX_OUTPUT_SATOSHI_BYTE_LEN, 'spent amount byte length must be 8');
            } else {
                assert(scriptLen == 0n, 'invalid spent amount list');
            }
        }
        return ctx[0] + ctx[1] + ctx[2] + ctx[3] + ctx[4] + ctx[5];
    }

    /**
     * Convert tx input index or output index from value to bytes
     * @param indexVal value of the input index or output index
     * @returns ByteString of the input index or output index
     */
    @method()
    static indexValueToBytes(indexVal: int32): ByteString {
        assert(indexVal >= TX_IO_INDEX_VAL_MIN && indexVal <= TX_IO_INDEX_VAL_MAX);
        let indexBytes = int2ByteString(indexVal);
        if (indexBytes == toByteString('')) {
            indexBytes = toByteString('00');
        }
        return indexBytes + toByteString('000000');
    }

    /**
     * Check if the index value and bytes are matched
     * @param indexVal value of the input index or output index
     * @param indexBytes ByteString of the input index or output index
     */
    @method()
    static checkIndex(indexVal: int32, indexBytes: ByteString): void {
        assert(TxUtils.indexValueToBytes(indexVal) == indexBytes);
    }

    /**
     * Build serialized tx output
     * @param script serialized locking script of the output
     * @param satoshis serialized satoshis of the output
     * @returns serialized tx output in format ByteString
     */
    @method()
    static buildOutput(script: ByteString, satoshis: ByteString): ByteString {
        const scriptLen = len(script);
        assert(scriptLen > 0 && scriptLen <= TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
        assert(len(satoshis) == TX_OUTPUT_SATOSHI_BYTE_LEN);
        return satoshis + int2ByteString(scriptLen) + script;
    }

    /**
     * Build serialized state hash root output
     * @param hashRoot state hash root
     * @returns serialized state hash root output in format ByteString
     */
    @method()
    static buildStateHashRootOutput(hashRoot: ByteString): ByteString {
        return TxUtils.buildOutput(TxUtils.buildStateHashRootScript(hashRoot), TxUtils.ZERO_SATS);
    }

    /**
     * Build locking script of state hash root output from state hash root
     * @param hashRoot state hash root
     * @returns locking script of state hash root output
     */
    @method()
    static buildStateHashRootScript(hashRoot: ByteString): ByteString {
        assert(len(hashRoot) == STATE_HASH_ROOT_BYTE_LEN);
        // op_return + op_push24 + "cat" (0x636174) + version (0x01) + hashRoot
        return toByteString('6a1863617401') + hashRoot;
    }

    /**
     * Build serialized change output
     * @param change change output to build
     * @returns serialized change output in format ByteString
     */
    @method()
    static buildChangeOutput(change: TxOut): ByteString {
        return change.satoshis != TxUtils.ZERO_SATS
            ? TxUtils.buildOutput(change.script, change.satoshis)
            : toByteString('');
    }

    /**
     * Merge tx input into a ByteString
     * @param txInput tx input, must be a segwit input
     * @returns serialized tx input
     */
    @method()
    static mergeInput(txInput: TxIn): ByteString {
        assert(len(txInput.prevTxHash) == TX_INPUT_PREV_TX_HASH_BYTE_LEN);
        TxUtils.checkIndex(txInput.prevOutputIndexVal, txInput.prevOutputIndex);
        assert(len(txInput.sequence) == TX_INPUT_SEQUENCE_BYTE_LEN);
        return txInput.prevTxHash + txInput.prevOutputIndex + toByteString('00') + txInput.sequence;
    }
}
