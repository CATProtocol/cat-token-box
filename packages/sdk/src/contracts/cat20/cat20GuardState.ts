import {
    assert,
    ByteString,
    FixedArray,
    GUARD_TOKEN_TYPE_MAX,
    len,
    method,
    STATE_HASH_BYTE_LEN,
    StateLib,
    TX_INPUT_COUNT_MAX,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
} from '@scrypt-inc/scrypt-ts-btc';
import { CAT20GuardConstState } from './types';

export class CAT20GuardStateLib extends StateLib<CAT20GuardConstState> {
    @method()
    static checkState(_state: CAT20GuardConstState): void {
        CAT20GuardStateLib.checkTokenScriptsUniq(_state.tokenScripts);

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
}
