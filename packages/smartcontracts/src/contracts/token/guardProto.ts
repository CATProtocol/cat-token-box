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

export type GuardConstState = {
    tokenScript: ByteString
    inputTokenAmountArray: FixedArray<int32, typeof MAX_INPUT>
}

export class GuardProto extends SmartContractLib {
    @method()
    static stateHash(_state: GuardConstState): ByteString {
        let inputOutpointAll = _state.tokenScript
        for (let i = 0; i < MAX_INPUT; i++) {
            inputOutpointAll += int2ByteString(_state.inputTokenAmountArray[i])
        }
        return hash160(inputOutpointAll)
    }

    static toByteString(state: GuardConstState) {
        return GuardProto.toList(state).join('')
    }

    static createEmptyState(): GuardConstState {
        return {
            tokenScript: toByteString(''),
            inputTokenAmountArray: emptyBigIntArray(),
        }
    }

    static toList(state: GuardConstState) {
        const dataList = [
            state.tokenScript,
            ...intArrayToByteString(state.inputTokenAmountArray),
        ]
        return dataList
    }
}
