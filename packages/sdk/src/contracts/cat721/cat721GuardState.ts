import {
    assert,
    ByteString,
    FixedArray,
    len,
    method,
    NFT_GUARD_COLLECTION_TYPE_MAX,
    Ripemd160,
    STATE_HASH_BYTE_LEN,
    StateLib,
    TX_INPUT_COUNT_MAX,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
} from '@scrypt-inc/scrypt-ts-btc';
import { CAT721GuardConstState } from './types.js';

export class CAT721GuardStateLib extends StateLib<CAT721GuardConstState> {
    @method()
    static formalCheckState(_state: CAT721GuardConstState): Ripemd160 {
        CAT721GuardStateLib.checkNftScriptsUniq(_state.nftScripts);

        for (let i = 0; i < NFT_GUARD_COLLECTION_TYPE_MAX; i++) {
            const scriptLen = len(_state.nftScripts[i]);
            assert(scriptLen == 1n || scriptLen == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
        }

        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const stateHashLen = len(_state.inputStateHashes[i]);
            assert(stateHashLen == 0n || stateHashLen == STATE_HASH_BYTE_LEN);

            const scriptIndex = _state.nftScriptIndexes[i];
            assert(scriptIndex >= -1 && scriptIndex < NFT_GUARD_COLLECTION_TYPE_MAX);
        }
        return CAT721GuardStateLib.stateHash(_state);
    }

    @method()
    static checkNftScriptsUniq(nftScripts: FixedArray<ByteString, typeof NFT_GUARD_COLLECTION_TYPE_MAX>): void {
        // c42
        assert(nftScripts[0] != nftScripts[1]);
        assert(nftScripts[0] != nftScripts[2]);
        assert(nftScripts[0] != nftScripts[3]);
        assert(nftScripts[1] != nftScripts[2]);
        assert(nftScripts[1] != nftScripts[3]);
        assert(nftScripts[2] != nftScripts[3]);
    }
}
