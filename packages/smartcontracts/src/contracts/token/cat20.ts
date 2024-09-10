import {
    ByteString,
    SmartContract,
    prop,
    method,
    assert,
    PubKey,
    Sig,
    hash160,
    FixedArray,
} from 'scrypt-ts'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../utils/sigHashUtils'
import { MAX_INPUT, STATE_OUTPUT_INDEX, int32 } from '../utils/txUtil'
import { TxProof, XrayedTxIdPreimg3 } from '../utils/txProof'
import { PreTxStatesInfo, StateUtils } from '../utils/stateUtils'
import { CAT20State, CAT20Proto } from './cat20Proto'
import { GuardConstState, GuardProto } from './guardProto'
import { Backtrace, BacktraceInfo } from '../utils/backtrace'

export type GuardInfo = {
    tx: XrayedTxIdPreimg3
    inputIndexVal: int32
    outputIndex: ByteString
    guardState: GuardConstState
}

export type TokenUnlockArgs = {
    // `true`: spend by user, `false`: spend by contract
    isUserSpend: boolean

    // user spend args
    userPubKeyPrefix: ByteString
    userPubKey: PubKey
    userSig: Sig

    // contract spend arg
    contractInputIndex: int32
}

export class CAT20 extends SmartContract {
    @prop()
    minterScript: ByteString

    @prop()
    guardScript: ByteString

    constructor(minterScript: ByteString, guardScript: ByteString) {
        super(...arguments)
        this.minterScript = minterScript
        this.guardScript = guardScript
    }

    @method()
    public unlock(
        tokenUnlockArgs: TokenUnlockArgs,

        // verify preTx data part
        preState: CAT20State,
        preTxStatesInfo: PreTxStatesInfo,

        // amount check guard
        guardInfo: GuardInfo,
        // backtrace
        backtraceInfo: BacktraceInfo,
        // common args
        // current tx info
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
        // verify state
        StateUtils.verifyPreStateHash(
            preTxStatesInfo,
            CAT20Proto.stateHash(preState),
            backtraceInfo.preTx.outputScriptList[STATE_OUTPUT_INDEX],
            prevoutsCtx.outputIndexVal
        )

        const preScript = spentScripts[Number(prevoutsCtx.inputIndexVal)]
        Backtrace.verifyToken(
            prevoutsCtx.spentTxhash,
            backtraceInfo,
            this.minterScript,
            preScript
        )

        // make sure the token is spent with a valid guard
        this.valitateGuard(
            guardInfo,
            preScript,
            preState,
            prevoutsCtx.inputIndexVal,
            prevoutsCtx.prevouts,
            spentScripts
        )

        if (tokenUnlockArgs.isUserSpend) {
            // unlock token owned by user key
            assert(
                hash160(
                    tokenUnlockArgs.userPubKeyPrefix +
                        tokenUnlockArgs.userPubKey
                ) == preState.ownerAddr
            )
            assert(
                this.checkSig(
                    tokenUnlockArgs.userSig,
                    tokenUnlockArgs.userPubKey
                )
            )
        } else {
            // unlock token owned by contract script
            assert(
                preState.ownerAddr ==
                    hash160(
                        spentScripts[Number(tokenUnlockArgs.contractInputIndex)]
                    )
            )
        }
    }

    @method()
    valitateGuard(
        guardInfo: GuardInfo,
        preScript: ByteString,
        preState: CAT20State,
        inputIndexVal: int32,
        prevouts: FixedArray<ByteString, typeof MAX_INPUT>,
        spentScripts: SpentScriptsCtx
    ): boolean {
        // check amount script
        const guardHashRoot = GuardProto.stateHash(guardInfo.guardState)
        assert(guardInfo.guardState.tokenScript == preScript)
        assert(
            StateUtils.getStateScript(guardHashRoot, 1n) ==
                guardInfo.tx.outputScriptList[STATE_OUTPUT_INDEX]
        )
        assert(preState.amount > 0n)
        assert(
            guardInfo.guardState.inputTokenAmountArray[Number(inputIndexVal)] ==
                preState.amount
        )
        const guardTxid = TxProof.getTxIdFromPreimg3(guardInfo.tx)
        assert(
            prevouts[Number(guardInfo.inputIndexVal)] ==
                guardTxid + guardInfo.outputIndex
        )
        assert(
            spentScripts[Number(guardInfo.inputIndexVal)] == this.guardScript
        )
        return true
    }
}
