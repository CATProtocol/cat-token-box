import {
    method,
    SmartContract,
    assert,
    prop,
    ByteString,
    PubKey,
    Sig,
    toByteString,
    hash160,
    sha256,
} from 'scrypt-ts'
import { ChangeInfo, STATE_OUTPUT_INDEX, TxUtil, int32 } from '../utils/txUtil'
import {
    PrevoutsCtx,
    SHPreimage,
    SigHashUtils,
    SpentScriptsCtx,
} from '../utils/sigHashUtils'
import { Backtrace, BacktraceInfo } from '../utils/backtrace'
import {
    StateUtils,
    PreTxStatesInfo,
    TxoStateHashes,
} from '../utils/stateUtils'
import { CAT721Proto, CAT721State } from './cat721Proto'
import {
    NftMerkleLeaf,
    NftOpenMinterProto,
    NftOpenMinterState,
} from './nftOpenMinterProto'
import {
    LeafNeighbor,
    LeafNeighborType,
    NftOpenMinterMerkleTree,
} from './nftOpenMinterMerkleTree'

export class NftOpenMinter extends SmartContract {
    @prop()
    genesisOutpoint: ByteString

    @prop()
    max: int32

    @prop()
    premine: int32

    @prop()
    premineAddr: ByteString

    constructor(
        genesisOutpoint: ByteString,
        maxCount: int32,
        premine: int32,
        premineAddr: ByteString
    ) {
        super(...arguments)
        this.genesisOutpoint = genesisOutpoint
        this.max = maxCount
        this.premine = premine
        this.premineAddr = premineAddr
    }

    @method()
    public mint(
        //
        curTxoStateHashes: TxoStateHashes,
        // contract logic args
        nftMint: CAT721State,

        neighbor: LeafNeighbor,
        neighborType: LeafNeighborType,

        // premine related args
        preminerPubKeyPrefix: ByteString,
        preminerPubKey: PubKey,
        preminerSig: Sig,

        // satoshis locked in minter utxo
        minterSatoshis: ByteString,
        // satoshis locked in token utxo
        nftSatoshis: ByteString,
        // unlock utxo state info
        preState: NftOpenMinterState,
        preTxStatesInfo: PreTxStatesInfo,
        // backtrace info, use b2g
        backtraceInfo: BacktraceInfo,
        // common args
        // current tx info
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
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
            spentScriptsCtx,
            shPreimage.hashSpentScripts
        )
        // verify state
        StateUtils.verifyPreStateHash(
            preTxStatesInfo,
            NftOpenMinterProto.stateHash(preState),
            backtraceInfo.preTx.outputScriptList[STATE_OUTPUT_INDEX],
            prevoutsCtx.outputIndexVal
        )
        // minter need at input 0
        assert(prevoutsCtx.inputIndexVal == 0n)
        // check preTx script eq this locking script
        const preScript = spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
        //
        const commitScript = spentScriptsCtx[1]
        const oldLeaf: NftMerkleLeaf = {
            commitScript: commitScript,
            localId: preState.nextLocalId,
            isMined: false,
        }
        const oldLeafBytes = NftOpenMinterProto.nftMerkleLeafToString(oldLeaf)
        const newLeaf: NftMerkleLeaf = {
            commitScript: commitScript,
            localId: preState.nextLocalId,
            isMined: true,
        }
        const newLeafBytes = NftOpenMinterProto.nftMerkleLeafToString(newLeaf)
        const newMerkleRoot = NftOpenMinterMerkleTree.updateLeaf(
            hash160(oldLeafBytes),
            hash160(newLeafBytes),
            neighbor,
            neighborType,
            preState.merkleRoot
        )
        // back to genesis
        Backtrace.verifyUnique(
            prevoutsCtx.spentTxhash,
            backtraceInfo,
            this.genesisOutpoint,
            preScript
        )

        let nftOpenMinterOutput = toByteString('')
        let curStateHashes = toByteString('')
        let curStateCnt = 1n
        const nextLocalId = preState.nextLocalId + 1n
        if (nextLocalId != this.max) {
            nftOpenMinterOutput += TxUtil.buildOutput(preScript, minterSatoshis)
            curStateHashes += hash160(
                NftOpenMinterProto.stateHash({
                    nftScript: preState.nftScript,
                    merkleRoot: newMerkleRoot,
                    nextLocalId: nextLocalId,
                })
            )
            curStateCnt += 1n
        }
        assert(nftMint.localId == preState.nextLocalId)
        // mint nft
        curStateHashes += hash160(CAT721Proto.stateHash(nftMint))
        const nftOutput = TxUtil.buildOutput(preState.nftScript, nftSatoshis)
        if (nftMint.localId < this.premine) {
            // premine need checksig
            assert(
                hash160(preminerPubKeyPrefix + preminerPubKey) ==
                    this.premineAddr
            )
            assert(this.checkSig(preminerSig, preminerPubKey))
        }
        const stateOutput = StateUtils.getCurrentStateOutput(
            curStateHashes,
            curStateCnt,
            curTxoStateHashes
        )
        const changeOutput = TxUtil.getChangeOutput(changeInfo)
        const hashOutputs = sha256(
            stateOutput + nftOpenMinterOutput + nftOutput + changeOutput
        )
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }
}
