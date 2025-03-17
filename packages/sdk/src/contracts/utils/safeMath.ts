import { Int32, SmartContractLib, method, assert } from '@scrypt-inc/scrypt-ts-btc';

export class SafeMath extends SmartContractLib {
    @method()
    static add(a: Int32, b: Int32): Int32 {
        const c = a + b;
        assert(c >= a);
        return c;
    }
}
