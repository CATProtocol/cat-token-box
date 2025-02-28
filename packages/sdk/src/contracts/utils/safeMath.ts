import { SmartContractLib, assert, method } from 'scrypt-ts';
import { int32 } from '../types';

export class SafeMath extends SmartContractLib {
    @method()
    static add(a: int32, b: int32): int32 {
        const c = a + b;
        assert(c >= a);
        return c;
    }
}
