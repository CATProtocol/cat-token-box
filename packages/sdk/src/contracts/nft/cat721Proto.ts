import { assert, ByteString, hash160, int2ByteString, method, SmartContractLib } from 'scrypt-ts';
import { CAT721State } from './types';
import { int32 } from '../types';
import { OwnerUtils } from '../utils/ownerUtils';

export class CAT721Proto extends SmartContractLib {
    @method()
    static stateHash(_state: CAT721State): ByteString {
        return hash160(CAT721Proto.propHashes(_state));
    }

    @method()
    static checkState(_state: CAT721State): void {
        OwnerUtils.checkOwnerAddr(_state.ownerAddr);
        assert(_state.localId >= 0);
    }

    @method()
    static propHashes(_state: CAT721State): ByteString {
        CAT721Proto.checkState(_state);
        return hash160(_state.ownerAddr) + hash160(int2ByteString(_state.localId));
    }

    static create(localId: int32, address: ByteString): CAT721State {
        return {
            ownerAddr: address,
            localId: localId,
        };
    }
}
