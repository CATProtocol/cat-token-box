import {
    ByteString,
    FixedArray,
    SmartContract,
    assert,
    hash160,
    int2ByteString,
    len,
    method,
    sha256,
    toByteString,
} from 'scrypt-ts'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../utils/sigHashUtils'
import {
    MAX_INPUT,
    MAX_STATE,
    MAX_TOKEN_OUTPUT,
    TxUtil,
    int32,
} from '../utils/txUtil'
import { XrayedTxIdPreimg3 } from '../utils/txProof'
import { GuardConstState, GuardProto } from './guardProto'
import { StateUtils, TxoStateHashes } from '../utils/stateUtils'

export class TransferGuard extends SmartContract {
    @method()
    public transfer(
        curTxoStateHashes: TxoStateHashes,
        // token owner address or other output locking script
        ownerAddrOrScriptList: FixedArray<ByteString, typeof MAX_TOKEN_OUTPUT>,
        tokenAmountList: FixedArray<int32, typeof MAX_TOKEN_OUTPUT>,
        tokenOutputMaskList: FixedArray<boolean, typeof MAX_TOKEN_OUTPUT>,
        outputSatoshisList: FixedArray<ByteString, typeof MAX_TOKEN_OUTPUT>,
        tokenSatoshis: ByteString,

        // verify preTx data part
        preState: GuardConstState,
        // check deploy tx
        preTx: XrayedTxIdPreimg3,
        //
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScripts: SpentScriptsCtx
    ) {
        // Check sighash preimage.
        assert(
            this.checkSig(
                SigHashUtils.checkSHPreimage(shPreimage),
                SigHashUtils.Gx
            ),
            'preimage check error'
        )
        // check ctx
        SigHashUtils.checkPrevoutsCtx(
            prevoutsCtx,
            shPreimage.hashPrevouts,
            shPreimage.inputIndex
        )
        SigHashUtils.checkSpentScriptsCtx(
            spentScripts,
            shPreimage.hashSpentScripts
        )
        // check preTx
        StateUtils.verifyGuardStateHash(
            preTx,
            prevoutsCtx.spentTxhash,
            GuardProto.stateHash(preState)
        )
        // sum input amount
        let sumInputToken = 0n
        for (let i = 0; i < MAX_INPUT; i++) {
            const script = spentScripts[i]
            if (script == preState.tokenScript) {
                const preSumInputToken = sumInputToken
                sumInputToken += preState.inputTokenAmountArray[i]
                assert(sumInputToken > preSumInputToken)
            }
        }
        let stateHashString = toByteString('')
        let outputs = toByteString('')
        let sumOutputToken = 0n
        const tokenOutput = TxUtil.buildOutput(
            preState.tokenScript,
            tokenSatoshis
        )
        // sum output amount, build token outputs, build token state hash
        for (let i = 0; i < MAX_STATE; i++) {
            const addrOrScript = ownerAddrOrScriptList[i]
            if (tokenOutputMaskList[i]) {
                // token owner address
                const tokenAmount = tokenAmountList[i]
                assert(tokenAmount > 0n)
                sumOutputToken = sumOutputToken + tokenAmount
                outputs = outputs + tokenOutput
                const tokenStateHash = hash160(
                    hash160(addrOrScript + int2ByteString(tokenAmount))
                )
                assert(hash160(curTxoStateHashes[i]) == tokenStateHash)
                stateHashString += tokenStateHash
            } else {
                // other output locking script
                assert(addrOrScript != preState.tokenScript)
                stateHashString += hash160(curTxoStateHashes[i])
                if (len(addrOrScript) > 0) {
                    outputs += TxUtil.buildOutput(
                        addrOrScript,
                        outputSatoshisList[i]
                    )
                }
            }
        }
        assert(sumInputToken > 0n)
        assert(sumInputToken == sumOutputToken)
        const stateOutput = TxUtil.buildOpReturnRoot(
            TxUtil.getStateScript(hash160(stateHashString))
        )
        const hashOutputs = sha256(stateOutput + outputs)
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }
}
