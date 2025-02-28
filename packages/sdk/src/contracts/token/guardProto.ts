import {
    ByteString,
    FixedArray,
    SmartContractLib,
    assert,
    fill,
    hash160,
    int2ByteString,
    len,
    method,
    toByteString,
} from 'scrypt-ts';
import {
    TX_INPUT_COUNT_MAX,
    GUARD_TOKEN_TYPE_MAX,
    STATE_HASH_BYTE_LEN,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
} from '../constants';
import { GuardConstState } from './types';

export class GuardProto extends SmartContractLib {
    /**
     * Convert raw state to state hash
     * @param _state raw state
     * @returns state hash
     */
    @method()
    static stateHash(_state: GuardConstState): ByteString {
        return hash160(GuardProto.propHashes(_state));
    }

    @method()
    static checkState(_state: GuardConstState): void {
        GuardProto.checkTokenScriptsUniq(_state.tokenScripts);

        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            const scriptLen = len(_state.tokenScripts[i]);
            assert(scriptLen == 1n || scriptLen == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);

            assert(_state.tokenAmounts[i] >= 0);
            assert(_state.tokenBurnAmounts[i] >= 0);
        }

        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const stateHashLen = len(_state.inputStateHashes[i]);
            assert(stateHashLen == 0n || stateHashLen == STATE_HASH_BYTE_LEN);

            const scriptIndex = _state.tokenScriptIndexes[i];
            assert(scriptIndex >= -1 && scriptIndex < GUARD_TOKEN_TYPE_MAX);
        }
    }

    /**
     * Convert raw state into a single ByteString, aka prop hashes
     * @param _state raw state
     * @returns prop hashes in format ByteString
     */
    @method()
    static propHashes(_state: GuardConstState): ByteString {
        GuardProto.checkState(_state);
        let propHashes = toByteString('');
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            propHashes += hash160(_state.inputStateHashes[i]);
        }
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            propHashes += hash160(_state.tokenScripts[i]);
        }
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            propHashes += hash160(int2ByteString(_state.tokenAmounts[i]));
        }
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            propHashes += hash160(int2ByteString(_state.tokenBurnAmounts[i]));
        }
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            propHashes += hash160(int2ByteString(_state.tokenScriptIndexes[i]));
        }
        return propHashes;
    }

    /**
     * Ensure tokenScripts does not have duplicate values
     * @param tokenScripts token scripts
     */
    @method()
    static checkTokenScriptsUniq(tokenScripts: FixedArray<ByteString, typeof GUARD_TOKEN_TYPE_MAX>): void {
        // c42
        assert(tokenScripts[0] != tokenScripts[1]);
        assert(tokenScripts[0] != tokenScripts[2]);
        assert(tokenScripts[0] != tokenScripts[3]);
        assert(tokenScripts[1] != tokenScripts[2]);
        assert(tokenScripts[1] != tokenScripts[3]);
        assert(tokenScripts[2] != tokenScripts[3]);
    }

    static createEmptyState(): GuardConstState {
        const tokenScripts = fill(toByteString(''), GUARD_TOKEN_TYPE_MAX);
        // default value to ensure the uniqueness of token scripts
        tokenScripts[0] = 'ff';
        tokenScripts[1] = 'fe';
        tokenScripts[2] = 'fd';
        tokenScripts[3] = 'fc';
        return {
            tokenScripts: tokenScripts,
            tokenAmounts: fill(0n, GUARD_TOKEN_TYPE_MAX),
            tokenBurnAmounts: fill(0n, GUARD_TOKEN_TYPE_MAX),
            inputStateHashes: fill(toByteString(''), TX_INPUT_COUNT_MAX),
            tokenScriptIndexes: fill(-1n, TX_INPUT_COUNT_MAX),
        };
    }
}
