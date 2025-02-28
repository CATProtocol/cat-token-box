import { assert, ByteString, hash160, int2ByteString, len, method, SmartContractLib } from 'scrypt-ts';
import { NftParallelClosedMinterState } from '../types';
import { TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN } from '../../constants';

export class NftParallelClosedMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: NftParallelClosedMinterState): ByteString {
        return hash160(NftParallelClosedMinterProto.propHashes(_state));
    }

    @method()
    static checkState(_state: NftParallelClosedMinterState): void {
        assert(len(_state.nftScript) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
        assert(_state.nextLocalId >= 0n);
    }

    @method()
    static propHashes(closeMinterInfo: NftParallelClosedMinterState): ByteString {
        NftParallelClosedMinterProto.checkState(closeMinterInfo);
        return hash160(closeMinterInfo.nftScript) + hash160(int2ByteString(closeMinterInfo.nextLocalId));
    }
}
