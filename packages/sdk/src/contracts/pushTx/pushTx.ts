import { SmartContract, method, assert } from 'scrypt-ts';
import { SHPreimage } from '../types';
import { ContextUtils } from '../utils/contextUtils';

export class PushTx extends SmartContract {
    @method()
    public unlock(shPreimage: SHPreimage) {
        // check sighash preimage
        assert(
            this.checkSig(ContextUtils.checkSHPreimage(shPreimage), ContextUtils.Gx),
            'sighash preimage check error',
        );
    }
}
