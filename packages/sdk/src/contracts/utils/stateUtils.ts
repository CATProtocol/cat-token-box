import {
    ByteString,
    FixedArray,
    SmartContractLib,
    hash160,
    method,
    toByteString,
    assert,
} from 'scrypt-ts'
import { MAX_STATE, STATE_OUTPUT_INDEX, TxUtil, int32 } from './txUtil'
import { TxProof, XrayedTxIdPreimg3 } from './txProof'

export type TxoStateHashes = FixedArray<ByteString, typeof MAX_STATE>

export type PreTxStatesInfo = {
    statesHashRoot: ByteString
    txoStateHashes: TxoStateHashes
}

export class StateUtils extends SmartContractLib {
    @method()
    static verifyStateRoot(
        txoStateHashes: FixedArray<ByteString, typeof MAX_STATE>,
        statesHashRoot: ByteString
    ): boolean {
        let rawString = toByteString('')
        for (let i = 0; i < MAX_STATE; i++) {
            rawString += hash160(txoStateHashes[i])
        }
        return hash160(rawString) == statesHashRoot
    }

    @method()
    static getPadding(stateNumber: int32): ByteString {
        const number = BigInt(MAX_STATE) - stateNumber
        let padding = toByteString('')
        for (let index = 0; index < MAX_STATE; index++) {
            if (index < number) {
                padding += hash160(toByteString(''))
            }
        }
        return padding
    }

    @method()
    static getStateScript(
        hashString: ByteString,
        stateNumber: int32
    ): ByteString {
        return TxUtil.getStateScript(
            hash160(hash160(hashString) + StateUtils.getPadding(stateNumber))
        )
    }

    @method()
    static getCurrentStateOutput(
        hashString: ByteString,
        stateNumber: int32,
        stateHashList: FixedArray<ByteString, typeof MAX_STATE>
    ): ByteString {
        const hashRoot = hash160(
            hashString + StateUtils.getPadding(stateNumber)
        )
        assert(StateUtils.verifyStateRoot(stateHashList, hashRoot))
        return TxUtil.buildOpReturnRoot(TxUtil.getStateScript(hashRoot))
    }

    @method()
    static verifyPreStateHash(
        statesInfo: PreTxStatesInfo,
        preStateHash: ByteString,
        preTxStateScript: ByteString,
        outputIndex: int32
    ): boolean {
        // verify preState
        assert(
            TxUtil.getStateScript(statesInfo.statesHashRoot) ==
                preTxStateScript,
            'preStateHashRoot mismatch'
        )
        assert(
            StateUtils.verifyStateRoot(
                statesInfo.txoStateHashes,
                statesInfo.statesHashRoot
            ),
            'preData error'
        )
        assert(
            preStateHash == statesInfo.txoStateHashes[Number(outputIndex - 1n)],
            'preState hash mismatch'
        )
        return true
    }

    @method()
    static verifyGuardStateHash(
        preTx: XrayedTxIdPreimg3,
        preTxhash: ByteString,
        preStateHash: ByteString
    ): boolean {
        assert(
            TxProof.getTxIdFromPreimg3(preTx) == preTxhash,
            'preTxHeader error'
        )
        assert(
            StateUtils.getStateScript(preStateHash, 1n) ==
                preTx.outputScriptList[STATE_OUTPUT_INDEX],
            'preStateHashRoot mismatch'
        )
        return true
    }
}
