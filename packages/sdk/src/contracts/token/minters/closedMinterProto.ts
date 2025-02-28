import { assert, ByteString, hash160, len, method, SmartContractLib } from 'scrypt-ts';
import { ClosedMinterState } from '../types';
import { TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN } from '../../constants';

export class ClosedMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: ClosedMinterState): ByteString {
        return hash160(ClosedMinterProto.propHashes(_state));
    }

    @method()
    static checkState(_state: ClosedMinterState): void {
        assert(len(_state.tokenScript) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
    }

    @method()
    static propHashes(_state: ClosedMinterState): ByteString {
        ClosedMinterProto.checkState(_state);
        return hash160(_state.tokenScript);
    }
}
