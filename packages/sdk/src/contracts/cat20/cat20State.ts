import { assert, method, StateLib } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20State } from './types';
import { OwnerUtils } from '../utils/ownerUtils';

export class CAT20StateLib extends StateLib<CAT20State> {
    @method()
    static checkState(_state: CAT20State): void {
        OwnerUtils.checkOwnerAddr(_state.ownerAddr);
        assert(_state.amount > 0n, 'token amount should be non-negative');
    }
}
