import { assert, ByteString, hash160, int2ByteString, len, method, SmartContractLib } from 'scrypt-ts';
import { NftClosedMinterState } from '../types';
import { TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN } from '../../constants';

export class NftClosedMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: NftClosedMinterState): ByteString {
        return hash160(NftClosedMinterProto.propHashes(_state));
    }

    @method()
    static checkState(_state: NftClosedMinterState): void {
        assert(len(_state.nftScript) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
        assert(_state.maxLocalId > 0n);
        assert(_state.nextLocalId >= 0n);
        assert(_state.maxLocalId > _state.nextLocalId);
    }

    @method()
    static propHashes(_state: NftClosedMinterState): ByteString {
        NftClosedMinterProto.checkState(_state);
        return (
            hash160(_state.nftScript) +
            hash160(int2ByteString(_state.maxLocalId)) +
            hash160(int2ByteString(_state.nextLocalId))
        );
    }
}
