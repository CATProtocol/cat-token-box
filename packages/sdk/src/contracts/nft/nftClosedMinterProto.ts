import {
    ByteString,
    hash160,
    int2ByteString,
    method,
    SmartContractLib,
} from 'scrypt-ts'
import { int32 } from '../utils/txUtil'

export type NftClosedMinterState = {
    nftScript: ByteString
    quotaMaxLocalId: int32
    nextLocalId: int32
}

export class NftClosedMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: NftClosedMinterState): ByteString {
        return hash160(
            _state.nftScript +
                int2ByteString(_state.quotaMaxLocalId) +
                int2ByteString(_state.nextLocalId)
        )
    }

    static create(
        nftScript: ByteString,
        quotaLocalId: int32,
        nextLocalId: int32
    ): NftClosedMinterState {
        return {
            nftScript: nftScript,
            quotaMaxLocalId: quotaLocalId,
            nextLocalId: nextLocalId,
        }
    }

    static toByteString(closeMinterInfo: NftClosedMinterState) {
        return (
            closeMinterInfo.nftScript +
            int2ByteString(closeMinterInfo.quotaMaxLocalId) +
            int2ByteString(closeMinterInfo.nextLocalId)
        )
    }
}
