import { assert, ByteString, hash160, int2ByteString, len, method, SmartContractLib, toByteString } from 'scrypt-ts';
import { NftMerkleLeaf, NftOpenMinterState } from '../types';
import { HASH160_HASH_LEN, TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN } from '../../constants';

export class NftOpenMinterProto extends SmartContractLib {
    @method()
    static stateHash(_state: NftOpenMinterState): ByteString {
        return hash160(NftOpenMinterProto.propHashes(_state));
    }

    @method()
    static checkState(_state: NftOpenMinterState): void {
        assert(len(_state.nftScript) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
        assert(len(_state.merkleRoot) == HASH160_HASH_LEN);
        assert(_state.nextLocalId >= 0n);
    }

    @method()
    static propHashes(_state: NftOpenMinterState): ByteString {
        NftOpenMinterProto.checkState(_state);
        return hash160(_state.nftScript) + hash160(_state.merkleRoot) + hash160(int2ByteString(_state.nextLocalId));
    }

    @method()
    static leafStateHash(leaf: NftMerkleLeaf): ByteString {
        return hash160(NftOpenMinterProto.leafPropHashes(leaf));
    }

    @method()
    static checkLeaf(leaf: NftMerkleLeaf): void {
        assert(len(leaf.commitScript) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
        assert(leaf.localId >= 0);
    }

    @method()
    static leafPropHashes(leaf: NftMerkleLeaf): ByteString {
        NftOpenMinterProto.checkLeaf(leaf);
        const isMined = leaf.isMined ? toByteString('01') : toByteString('00');
        return hash160(leaf.commitScript) + hash160(int2ByteString(leaf.localId)) + hash160(isMined);
    }
}
