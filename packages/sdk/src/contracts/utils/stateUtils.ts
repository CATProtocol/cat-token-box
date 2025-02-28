import { ByteString, SmartContractLib, hash160, method, toByteString, assert, len } from 'scrypt-ts';
import { int32, StateHashes, InputStateProof } from '../types';
import { STATE_OUTPUT_COUNT_MAX, STATE_HASH_BYTE_LEN } from '../constants';
import { TxUtils } from './txUtils';
import { TxProof } from './txProof';

export class StateUtils extends SmartContractLib {
    /**
     * Check if stateHashes match hashRoot
     * @param stateHashes state hash array of tx outputs
     * @param hashRoot trustable state hash root
     */
    @method()
    static checkStateHashRoot(stateHashes: StateHashes, hashRoot: ByteString): void {
        let stateRoots = toByteString('');
        for (let i = 0; i < STATE_OUTPUT_COUNT_MAX; i++) {
            const stateHash = stateHashes[i];
            const stateHashLen = len(stateHash);
            assert(stateHashLen == 0n || stateHashLen == STATE_HASH_BYTE_LEN);
            stateRoots += hash160(stateHash);
        }
        assert(hash160(stateRoots) == hashRoot, 'stateHashes and hashRoot mismatch');
    }

    /**
     * Pad empty state roots to fill the state root array
     * @param stateCount the number of states
     * @returns padding state roots
     */
    @method()
    static padEmptyStateRoots(stateCount: int32): ByteString {
        const emptySlots = BigInt(STATE_OUTPUT_COUNT_MAX) - stateCount;
        assert(emptySlots >= 0n);
        let padding = toByteString('');
        for (let i = 0; i < STATE_OUTPUT_COUNT_MAX; i++) {
            if (i < emptySlots) {
                padding += hash160(toByteString(''));
            }
        }
        return padding;
    }

    /**
     * Build state hash root output with leading state roots, and verify the user pass-in stateHashes as well
     * @param leadingStateRoots leading state roots of curTx outputs
     * @param stateCount the number of states
     * @param stateHashes user passed-in stateHashes to verify
     * @returns serialized state hash root output in format ByteString
     */
    @method()
    static buildStateHashRootOutput(
        leadingStateRoots: ByteString,
        stateCount: int32,
        stateHashes: StateHashes,
    ): ByteString {
        const hashRoot = hash160(leadingStateRoots + StateUtils.padEmptyStateRoots(stateCount));
        StateUtils.checkStateHashRoot(stateHashes, hashRoot);
        return TxUtils.buildStateHashRootOutput(hashRoot);
    }

    /**
     * Use trustable hashRoot and outputIndex to check passed-in stateHashes and stateHash
     * @param stateHashes passed-in stateHashes
     * @param stateHash passed-in stateHash
     * @param hashRoot trustable hashRoot
     * @param outputIndex trustable outputIndex
     */
    @method()
    static checkStateHash(
        stateHashes: StateHashes,
        stateHash: ByteString,
        hashRoot: ByteString,
        outputIndex: int32,
    ): void {
        // hashRoot -> stateHashes
        StateUtils.checkStateHashRoot(stateHashes, hashRoot);
        // stateHashes + outputIndex -> stateHash
        assert(stateHash == stateHashes[Number(outputIndex - 1n)], 'stateHash and stateHashes mismatch');
    }

    /**
     * Check if state of prev output corresponding to an input
     * @param proof input state proof
     * @param stateHash state hash of prev output corresponding to this input
     * @param prevout prevout of this input which is trustable
     */
    @method()
    static checkInputState(proof: InputStateProof, stateHash: ByteString, prevout: ByteString): void {
        // prevout -> prevTxPreimage + prevOutputIndexVal
        const prevTxHash = TxProof.getTxHashFromPreimage3(proof.prevTxPreimage);
        const prevOutputIndex = TxUtils.indexValueToBytes(proof.prevOutputIndexVal);
        assert(prevTxHash + prevOutputIndex == prevout);

        // prevTxPreimage.hashRoot + prevOutputIndexVal -> proof.stateHashes + stateHash
        StateUtils.checkStateHash(
            proof.stateHashes,
            stateHash,
            proof.prevTxPreimage.hashRoot,
            proof.prevOutputIndexVal,
        );

        // both proof and stateHash have been verified
    }
}
