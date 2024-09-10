import {
    method,
    SmartContract,
    assert,
    prop,
    ByteString,
    sha256,
    PubKey,
    Sig,
    hash160,
    toByteString,
} from 'scrypt-ts'
import {
    TxUtil,
    ChangeInfo,
    STATE_OUTPUT_INDEX,
    STATE_OUTPUT_OFFSET,
} from '../utils/txUtil'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../utils/sigHashUtils'
import { Backtrace, BacktraceInfo } from '../utils/backtrace'
import { ClosedMinterState, ClosedMinterProto } from './closedMinterProto'
import {
    PreTxStatesInfo,
    StateUtils,
    TxoStateHashes,
} from '../utils/stateUtils'
import { CAT20Proto, CAT20State } from './cat20Proto'

export class ClosedMinter extends SmartContract {
    @prop()
    issuerAddress: ByteString

    @prop()
    genesisOutpoint: ByteString

    constructor(ownerAddress: ByteString, genesisOutpoint: ByteString) {
        super(...arguments)
        this.issuerAddress = ownerAddress
        this.genesisOutpoint = genesisOutpoint
    }

    @method()
    public mint(
        curTxoStateHashes: TxoStateHashes,
        // contrat logic args
        tokenMint: CAT20State,
        issuerPubKeyPrefix: ByteString,
        issuerPubKey: PubKey,
        issuerSig: Sig,
        // contract lock satoshis
        genesisSatoshis: ByteString,
        tokenSatoshis: ByteString,
        // verify preTx data part
        preState: ClosedMinterState,
        preTxStatesInfo: PreTxStatesInfo,

        // backtrace
        backtraceInfo: BacktraceInfo,

        // common args
        // current tx info
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScripts: SpentScriptsCtx,
        // change output info
        changeInfo: ChangeInfo
    ) {
        // check preimage
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
            ClosedMinterProto.stateHash(preState),
            backtraceInfo.preTx.outputScriptList[STATE_OUTPUT_INDEX],
            prevoutsCtx.outputIndexVal
        )
        // check preTx script eq this locking script
        const preScript = spentScripts[Number(prevoutsCtx.inputIndexVal)]
        // back to genesis
        Backtrace.verifyUnique(
            prevoutsCtx.spentTxhash,
            backtraceInfo,
            this.genesisOutpoint,
            preScript
        )
        let hashString = toByteString('')
        let genesisOutput = toByteString('')
        let stateNumber = 0n
        if (genesisSatoshis != TxUtil.ZEROSAT) {
            genesisOutput = TxUtil.buildOutput(preScript, genesisSatoshis)
            hashString += hash160(
                preTxStatesInfo.txoStateHashes[
                    Number(prevoutsCtx.outputIndexVal) - STATE_OUTPUT_OFFSET
                ]
            )
            stateNumber += 1n
        }
        hashString += hash160(
            CAT20Proto.stateHash({
                amount: tokenMint.amount,
                ownerAddr: tokenMint.ownerAddr,
            })
        )
        const tokenOutput = TxUtil.buildOutput(
            preState.tokenScript,
            tokenSatoshis
        )
        stateNumber += 1n
        const stateOutput = StateUtils.getCurrentStateOutput(
            hashString,
            stateNumber,
            curTxoStateHashes
        )
        const changeOutput = TxUtil.getChangeOutput(changeInfo)
        const hashOutputs = sha256(
            stateOutput + genesisOutput + tokenOutput + changeOutput
        )
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
        // check sig
        assert(this.issuerAddress == hash160(issuerPubKeyPrefix + issuerPubKey))
        assert(this.checkSig(issuerSig, issuerPubKey))
    }
}
