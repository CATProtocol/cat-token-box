import { assert, ByteString, hash160, int2ByteString, method, SmartContractLib } from 'scrypt-ts';
import { CAT20State } from './types';
import { int32 } from '../types';
import { OwnerUtils } from '../utils/ownerUtils';

export class CAT20Proto extends SmartContractLib {
    /**
     * Convert raw state to state hash
     * @param _state raw state
     * @returns state hash
     */
    @method()
    static stateHash(_state: CAT20State): ByteString {
        return hash160(CAT20Proto.propHashes(_state));
    }

    @method()
    static checkState(_state: CAT20State): void {
        OwnerUtils.checkOwnerAddr(_state.ownerAddr);
        assert(_state.amount > 0n, 'token amount should be non-negative');
    }

    /**
     * Convert raw state into a single ByteString, aka prop hashes
     * @param _state raw state
     * @returns prop hashes in format ByteString
     */
    @method()
    static propHashes(_state: CAT20State): ByteString {
        CAT20Proto.checkState(_state);
        return hash160(_state.ownerAddr) + hash160(int2ByteString(_state.amount));
    }

    static create(amount: int32, address: ByteString): CAT20State {
        return {
            amount,
            ownerAddr: address,
        };
    }
}
