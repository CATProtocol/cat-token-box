import { assert, method, StateLib } from '@scrypt-inc/scrypt-ts-btc';
import { CAT721State } from './types.js';
import { OwnerUtils } from '../utils/ownerUtils.js';

export class CAT721StateLib extends StateLib<CAT721State> {
    @method()
    static checkState(_state: CAT721State): void {
        OwnerUtils.checkOwnerAddr(_state.ownerAddr);
        assert(_state.localId >= 0);
    }
}
