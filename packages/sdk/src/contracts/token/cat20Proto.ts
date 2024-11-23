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

export type CAT20State = {
    // owner(user/contract) address
    ownerAddr: ByteString
    // token amount
    amount: int32
}

export class CAT20Proto extends SmartContractLib {
    @method()
    static stateHash(_state: CAT20State): ByteString {
        assert(len(_state.ownerAddr) == ADDRESS_HASH_LEN)
        return hash160(_state.ownerAddr + int2ByteString(_state.amount))
    }

    static create(amount: int32, address: ByteString): CAT20State {
        return {
            amount,
            ownerAddr: address,
        }
    }

    static toByteString(tokenInfo: CAT20State) {
        return tokenInfo.ownerAddr + int2ByteString(tokenInfo.amount)
    }
}
