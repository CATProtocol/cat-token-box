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
import { TxUtil, ChangeInfo, STATE_OUTPUT_INDEX, int32 } from '../utils/txUtil'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../utils/sigHashUtils'
import { Backtrace, BacktraceInfo } from '../utils/backtrace'
import {
    NftClosedMinterState,
    NftClosedMinterProto,
} from './nftClosedMinterProto'
import {
    PreTxStatesInfo,
    StateUtils,
    TxoStateHashes,
} from '../utils/stateUtils'
import { CAT721Proto, CAT721State } from './cat721Proto'

export class NftClosedMinter extends SmartContract {
    @prop()
    issuerAddress: ByteString

    @prop()
    genesisOutpoint: ByteString

    @prop()
    max: int32

    constructor(
        ownerAddress: ByteString,
        genesisOutpoint: ByteString,
        max: int32
    ) {
        super(...arguments)
        this.issuerAddress = ownerAddress
        this.genesisOutpoint = genesisOutpoint
        this.max = max
    }

    @method()
    public mint(
        curTxoStateHashes: TxoStateHashes,
        // contrat logic args
        nftMint: CAT721State,
        issuerPubKeyPrefix: ByteString,
        issuerPubKey: PubKey,
        issuerSig: Sig,
        // contract lock satoshis
        minterSatoshis: ByteString,
        nftSatoshis: ByteString,
        // verify preTx data part
        preState: NftClosedMinterState,
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
            NftClosedMinterProto.stateHash(preState),
            backtraceInfo.preTx.outputScriptList[STATE_OUTPUT_INDEX],
            prevoutsCtx.outputIndexVal
        )
        // minter need at input 0
        assert(prevoutsCtx.inputIndexVal == 0n)
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
        let minterOutput = toByteString('')
        let stateNumber = 0n
        const nextLocalId = preState.nextLocalId + 1n
        if (nextLocalId < preState.quotaMaxLocalId) {
            minterOutput = TxUtil.buildOutput(preScript, minterSatoshis)
            hashString += hash160(
                NftClosedMinterProto.stateHash({
                    nftScript: preState.nftScript,
                    quotaMaxLocalId: preState.quotaMaxLocalId,
                    nextLocalId: preState.nextLocalId + 1n,
                })
            )
            stateNumber += 1n
        }
        assert(nftMint.localId == preState.nextLocalId)
        hashString += hash160(CAT721Proto.stateHash(nftMint))
        const nft = TxUtil.buildOutput(preState.nftScript, nftSatoshis)
        stateNumber += 1n
        const stateOutput = StateUtils.getCurrentStateOutput(
            hashString,
            stateNumber,
            curTxoStateHashes
        )
        const changeOutput = TxUtil.getChangeOutput(changeInfo)
        const hashOutputs = sha256(
            stateOutput + minterOutput + nft + changeOutput
        )
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
        // check sig
        assert(this.issuerAddress == hash160(issuerPubKeyPrefix + issuerPubKey))
        assert(this.checkSig(issuerSig, issuerPubKey))
    }
}
