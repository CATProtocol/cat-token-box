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
    NftParallelClosedMinterState,
    NftParallelClosedMinterProto,
} from './nftParallelClosedMinterProto'
import {
    PreTxStatesInfo,
    StateUtils,
    TxoStateHashes,
} from '../utils/stateUtils'
import { CAT721Proto, CAT721State } from './cat721Proto'

export class NftParallelClosedMinter extends SmartContract {
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
        preState: NftParallelClosedMinterState,
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
            NftParallelClosedMinterProto.stateHash(preState),
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
        // is genesis
        const prevOutpoint =
            backtraceInfo.preTxInput.txhash +
            backtraceInfo.preTxInput.outputIndex
        if (prevOutpoint == this.genesisOutpoint) {
            // genesis only deploy one minter
            assert(preTxStatesInfo.txoStateHashes[1] == toByteString(''))
            assert(preTxStatesInfo.txoStateHashes[2] == toByteString(''))
            assert(preTxStatesInfo.txoStateHashes[3] == toByteString(''))
            assert(preTxStatesInfo.txoStateHashes[4] == toByteString(''))
        }
        let hashString = toByteString('')
        let minterOutput = toByteString('')
        let stateNumber = 0n
        // next 1
        const nextLocalId1 = preState.nextLocalId + preState.nextLocalId + 1n
        // next 2
        const nextLocalId2 = preState.nextLocalId + preState.nextLocalId + 2n
        if (nextLocalId1 < this.max) {
            minterOutput += TxUtil.buildOutput(preScript, minterSatoshis)
            hashString += hash160(
                NftParallelClosedMinterProto.stateHash({
                    nftScript: preState.nftScript,
                    nextLocalId: nextLocalId1,
                })
            )
            stateNumber += 1n
        }
        if (nextLocalId2 < this.max) {
            minterOutput += TxUtil.buildOutput(preScript, minterSatoshis)
            hashString += hash160(
                NftParallelClosedMinterProto.stateHash({
                    nftScript: preState.nftScript,
                    nextLocalId: nextLocalId2,
                })
            )
            stateNumber += 1n
        }
        assert(nftMint.localId == preState.nextLocalId)
        hashString += hash160(CAT721Proto.stateHash(nftMint))
        const nftOutput = TxUtil.buildOutput(preState.nftScript, nftSatoshis)
        stateNumber += 1n
        const stateOutput = StateUtils.getCurrentStateOutput(
            hashString,
            stateNumber,
            curTxoStateHashes
        )
        const changeOutput = TxUtil.getChangeOutput(changeInfo)
        const hashOutputs = sha256(
            stateOutput + minterOutput + nftOutput + changeOutput
        )
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
        // check sig
        assert(this.issuerAddress == hash160(issuerPubKeyPrefix + issuerPubKey))
        assert(this.checkSig(issuerSig, issuerPubKey))
    }
}
