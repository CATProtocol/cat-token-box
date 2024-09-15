import {
    ByteString,
    fill,
    hash160,
    int2ByteString,
    method,
    SmartContractLib,
    toByteString,
} from 'scrypt-ts'
import { Int32, int32 } from '../utils/txUtil'

export type OpenMinterState = {
    // mint token script
    tokenScript: ByteString
    // flag first mint
    isPremined: boolean
    // max open mint number
    remainingSupply: int32
}

export class OpenMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: OpenMinterState): ByteString {
        const isPreminedByte = _state.isPremined
            ? toByteString('01')
            : toByteString('00')
        return hash160(
            _state.tokenScript +
                isPreminedByte +
                int2ByteString(_state.remainingSupply)
        )
    }

    static create(
        tokenScript: ByteString,
        isPremined: boolean,
        remainingSupply: int32
    ): OpenMinterState {
        return {
            tokenScript: tokenScript,
            isPremined: isPremined,
            remainingSupply: remainingSupply,
        }
    }

    static toByteString(_state: OpenMinterState) {
        const isPreminedByte = _state.isPremined
            ? toByteString('01')
            : toByteString('00')
        return (
            _state.tokenScript +
            isPreminedByte +
            int2ByteString(_state.remainingSupply)
        )
    }

    static getSplitAmountList(
        preMax: int32,
        mintAmount: int32,
        limit: int32,
        splitMinterNumber: number
    ) {
        const splitAmount = fill(0n, 2)
        if (splitMinterNumber > 0 && splitMinterNumber <= 2) {
            const totalSplit = preMax - mintAmount
            const scale = Int32(splitMinterNumber) * limit
            const perMinterNumber = (totalSplit / scale) * limit
            const delta =
                totalSplit - perMinterNumber * Int32(splitMinterNumber)
            splitAmount[0] = perMinterNumber + delta
            for (let i = 1; i < splitMinterNumber; i++) {
                splitAmount[i] = perMinterNumber
            }
        }
        return splitAmount
    }
}
