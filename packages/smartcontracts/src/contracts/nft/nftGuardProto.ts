import {
    ByteString,
    FixedArray,
    SmartContractLib,
    hash160,
    int2ByteString,
    method,
    toByteString,
} from 'scrypt-ts'
import { emptyBigIntArray, intArrayToByteString } from '../../lib/proof'
import { MAX_INPUT, int32 } from '../utils/txUtil'

export type NftGuardConstState = {
    collectionScript: ByteString
    localIdArray: FixedArray<int32, typeof MAX_INPUT>
}

export class NftGuardProto extends SmartContractLib {
    @method()
    static stateHash(_state: NftGuardConstState): ByteString {
        let inputOutpointAll = _state.collectionScript
        for (let i = 0; i < MAX_INPUT; i++) {
            inputOutpointAll += int2ByteString(_state.localIdArray[i])
        }
        return hash160(inputOutpointAll)
    }

    static toByteString(state: NftGuardConstState) {
        return NftGuardProto.toList(state).join('')
    }

    static createEmptyState(): NftGuardConstState {
        return {
            collectionScript: toByteString(''),
            localIdArray: emptyBigIntArray(),
        }
    }

    static toList(state: NftGuardConstState) {
        const dataList = [
            state.collectionScript,
            ...intArrayToByteString(state.localIdArray),
        ]
        return dataList
    }
}
