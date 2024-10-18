import {
    assert,
    ByteString,
    hash160,
    int2ByteString,
    len,
    method,
    SmartContractLib,
} from 'scrypt-ts'
import { ADDRESS_HASH_LEN, int32 } from '../utils/txUtil'

export type CAT721State = {
    // owner(user/contract) address
    ownerAddr: ByteString
    // token index
    localId: int32
}

export class CAT721Proto extends SmartContractLib {
    @method()
    static stateHash(_state: CAT721State): ByteString {
        assert(len(_state.ownerAddr) == ADDRESS_HASH_LEN)
        return hash160(_state.ownerAddr + int2ByteString(_state.localId))
    }

    static create(address: ByteString, localId: int32): CAT721State {
        return {
            ownerAddr: address,
            localId: localId,
        }
    }

    static toByteString(tokenInfo: CAT721State) {
        return tokenInfo.ownerAddr + int2ByteString(tokenInfo.localId)
    }
}
