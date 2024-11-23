import {
    ByteString,
    hash160,
    int2ByteString,
    method,
    SmartContractLib,
} from 'scrypt-ts'
import { int32 } from '../utils/txUtil'

export type NftParallelClosedMinterState = {
    nftScript: ByteString
    nextLocalId: int32
}

export class NftParallelClosedMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: NftParallelClosedMinterState): ByteString {
        return hash160(_state.nftScript + int2ByteString(_state.nextLocalId))
    }

    static create(
        nftScript: ByteString,
        nextLocalId: int32
    ): NftParallelClosedMinterState {
        return {
            nftScript: nftScript,
            nextLocalId: nextLocalId,
        }
    }

    static toByteString(closeMinterInfo: NftParallelClosedMinterState) {
        return (
            closeMinterInfo.nftScript +
            int2ByteString(closeMinterInfo.nextLocalId)
        )
    }
}
