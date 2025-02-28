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
import { NftGuardConstState } from './types';
import {
    NFT_GUARD_COLLECTION_TYPE_MAX,
    STATE_HASH_BYTE_LEN,
    TX_INPUT_COUNT_MAX,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
} from '../constants';

export class NftGuardProto extends SmartContractLib {
    @method()
    static stateHash(_state: NftGuardConstState): ByteString {
        return hash160(NftGuardProto.propHashes(_state));
    }

    @method()
    static checkState(_state: NftGuardConstState): void {
        NftGuardProto.checkNftScriptsUniq(_state.nftScripts);

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
    }

    @method()
    static propHashes(_state: NftGuardConstState): ByteString {
        NftGuardProto.checkState(_state);
        let propHashes = toByteString('');
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            propHashes += hash160(_state.inputStateHashes[i]);
        }
        for (let i = 0; i < NFT_GUARD_COLLECTION_TYPE_MAX; i++) {
            propHashes += hash160(_state.nftScripts[i]);
        }
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            propHashes += hash160(_state.nftBurnMasks[i] ? toByteString('01') : toByteString('00'));
        }
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            propHashes += hash160(int2ByteString(_state.nftScriptIndexes[i]));
        }
        return propHashes;
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

    static createEmptyState(): NftGuardConstState {
        const nftScripts = fill(toByteString(''), NFT_GUARD_COLLECTION_TYPE_MAX);
        // default value to ensure the uniqueness of nft scripts
        nftScripts[0] = 'ff';
        nftScripts[1] = 'fe';
        nftScripts[2] = 'fd';
        nftScripts[3] = 'fc';
        return {
            nftScripts: nftScripts,
            nftBurnMasks: fill(false, TX_INPUT_COUNT_MAX),
            inputStateHashes: fill(toByteString(''), TX_INPUT_COUNT_MAX),
            nftScriptIndexes: fill(-1n, TX_INPUT_COUNT_MAX),
        };
    }
}
