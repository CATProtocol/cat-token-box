import { assert, ByteString, hash160, int2ByteString, len, method, SmartContractLib, toByteString } from 'scrypt-ts';
import { OpenMinterState } from '../types';
import { TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN } from '../../constants';

export class OpenMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: OpenMinterState): ByteString {
        return hash160(OpenMinterProto.propHashes(_state));
    }

    @method()
    static checkState(_state: OpenMinterState): void {
        assert(len(_state.tokenScript) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
        assert(_state.remainingCount > 0n);
    }

    @method()
    static propHashes(_state: OpenMinterState): ByteString {
        OpenMinterProto.checkState(_state);
        const mintedBefore = _state.hasMintedBefore ? toByteString('01') : toByteString('00');
        return hash160(_state.tokenScript) + hash160(mintedBefore) + hash160(int2ByteString(_state.remainingCount));
    }
}
