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
import { CAT721State, CAT721Proto } from './cat721Proto'
import { NftGuardConstState, NftGuardProto } from './nftGuardProto'
import { Backtrace, BacktraceInfo } from '../utils/backtrace'

export type NftGuardInfo = {
    tx: XrayedTxIdPreimg3
    inputIndexVal: int32
    outputIndex: ByteString
    guardState: NftGuardConstState
}

export type NftUnlockArgs = {
    // `true`: spend by user, `false`: spend by contract
    isUserSpend: boolean

    // user spend args
    userPubKeyPrefix: ByteString
    userPubKey: PubKey
    userSig: Sig

    // contract spend arg
    contractInputIndex: int32
}

export class CAT721 extends SmartContract {
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
        nftUnlockArgs: NftUnlockArgs,

        // verify preTx data part
        preState: CAT721State,
        preTxStatesInfo: PreTxStatesInfo,

        // amount check guard
        guardInfo: NftGuardInfo,
        // backtrace
        backtraceInfo: BacktraceInfo,
        // common args
        // current tx info
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx
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
            spentScriptsCtx,
            shPreimage.hashSpentScripts
        )
        // verify state
        StateUtils.verifyPreStateHash(
            preTxStatesInfo,
            CAT721Proto.stateHash(preState),
            backtraceInfo.preTx.outputScriptList[STATE_OUTPUT_INDEX],
            prevoutsCtx.outputIndexVal
        )

        const preScript = spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
        Backtrace.verifyToken(
            prevoutsCtx.spentTxhash,
            backtraceInfo,
            this.minterScript,
            preScript
        )

        // make sure the token is spent with a valid guard
        this.valitateNftGuard(
            guardInfo,
            preScript,
            preState,
            prevoutsCtx.inputIndexVal,
            prevoutsCtx.prevouts,
            spentScriptsCtx
        )

        if (nftUnlockArgs.isUserSpend) {
            // unlock token owned by user key
            assert(
                hash160(
                    nftUnlockArgs.userPubKeyPrefix + nftUnlockArgs.userPubKey
                ) == preState.ownerAddr
            )
            assert(
                this.checkSig(nftUnlockArgs.userSig, nftUnlockArgs.userPubKey)
            )
        } else {
            // unlock token owned by contract script
            assert(
                preState.ownerAddr ==
                    hash160(
                        spentScriptsCtx[
                            Number(nftUnlockArgs.contractInputIndex)
                        ]
                    )
            )
        }
    }

    @method()
    valitateNftGuard(
        guardInfo: NftGuardInfo,
        preScript: ByteString,
        preState: CAT721State,
        inputIndexVal: int32,
        prevouts: FixedArray<ByteString, typeof MAX_INPUT>,
        spentScripts: SpentScriptsCtx
    ): boolean {
        // check amount script
        const guardHashRoot = NftGuardProto.stateHash(guardInfo.guardState)
        assert(
            StateUtils.getStateScript(guardHashRoot, 1n) ==
                guardInfo.tx.outputScriptList[STATE_OUTPUT_INDEX]
        )
        assert(guardInfo.guardState.collectionScript == preScript)
        assert(preState.localId >= 0n)
        assert(
            guardInfo.guardState.localIdArray[Number(inputIndexVal)] ==
                preState.localId
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
