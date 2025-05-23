import { assert, method, StateLib } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20State } from './types.js';
import { OwnerUtils } from '../utils/ownerUtils.js';

export class CAT20StateLib extends StateLib<CAT20State> {
    @method()
    static checkState(_state: CAT20State): void {
        OwnerUtils.checkOwnerAddr(_state.ownerAddr);
        assert(_state.amount > 0n, 'token amount should be non-negative');
    }
}
