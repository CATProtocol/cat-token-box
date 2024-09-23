import {
    ByteString,
    fill,
    hash160,
    int2ByteString,
    method,
    SmartContractLib,
    toByteString,
} from 'scrypt-ts'
import { int32 } from '../utils/txUtil'

export type OpenMinterV2State = {
    // mint token script
    tokenScript: ByteString
    // flag first mint
    isPremined: boolean
    // max open mint count
    remainingSupplyCount: int32
}

export class OpenMinterV2Proto extends SmartContractLib {
    @method()
    static stateHash(_state: OpenMinterV2State): ByteString {
        const isPreminedByte = _state.isPremined
            ? toByteString('01')
            : toByteString('00')
        return hash160(
            _state.tokenScript +
                isPreminedByte +
                int2ByteString(_state.remainingSupplyCount)
        )
    }

    static create(
        tokenScript: ByteString,
        isPremined: boolean,
        remainingSupply: int32
    ): OpenMinterV2State {
        return {
            tokenScript: tokenScript,
            isPremined: isPremined,
            remainingSupplyCount: remainingSupply,
        }
    }

    static toByteString(_state: OpenMinterV2State) {
        const isPreminedByte = _state.isPremined
            ? toByteString('01')
            : toByteString('00')
        return (
            _state.tokenScript +
            isPreminedByte +
            int2ByteString(_state.remainingSupplyCount)
        )
    }

    static getSplitAmountList(
        preRemainingSupply: int32,
        isPremined: boolean,
        premineAmount: bigint
    ) {
        let nextSupply = preRemainingSupply - 1n
        if (!isPremined && premineAmount > 0n) {
            nextSupply = preRemainingSupply
        }
        const splitAmount = fill(nextSupply / 2n, 2)
        splitAmount[0] += nextSupply - splitAmount[0] * 2n
        return splitAmount
    }
}
