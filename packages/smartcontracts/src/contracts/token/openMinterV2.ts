import {
    method,
    SmartContract,
    assert,
    prop,
    ByteString,
    FixedArray,
    sha256,
    hash160,
    toByteString,
    PubKey,
    Sig,
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
import { CAT20State, CAT20Proto } from './cat20Proto'
import { OpenMinterV2Proto, OpenMinterV2State } from './openMinterV2Proto'

const MAX_NEXT_MINTERS = 2

export class OpenMinterV2 extends SmartContract {
    @prop()
    genesisOutpoint: ByteString

    @prop()
    maxCount: int32

    @prop()
    premine: int32

    @prop()
    premineCount: int32

    @prop()
    limit: int32

    @prop()
    premineAddr: ByteString

    constructor(
        genesisOutpoint: ByteString,
        maxCount: int32,
        premine: int32,
        premineCount: int32,
        limit: int32,
        premineAddr: ByteString
    ) {
        super(...arguments)
        this.genesisOutpoint = genesisOutpoint
        this.maxCount = maxCount
        /*
        Note: this assumes this.premineCount *  this.limit  == this.premine,
        which can be trivially validated by anyone after the token is deployed
        */
        this.premine = premine
        this.premineCount = premineCount
        this.limit = limit
        this.premineAddr = premineAddr
    }

    @method()
    public mint(
        //
        curTxoStateHashes: TxoStateHashes,
        // contract logic args
        tokenMint: CAT20State,
        nextMinterCounts: FixedArray<int32, typeof MAX_NEXT_MINTERS>,

        // premine related args
        preminerPubKeyPrefix: ByteString,
        preminerPubKey: PubKey,
        preminerSig: Sig,

        // satoshis locked in minter utxo
        minterSatoshis: ByteString,
        // satoshis locked in token utxo
        tokenSatoshis: ByteString,
        // unlock utxo state info
        preState: OpenMinterV2State,
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
            OpenMinterV2Proto.stateHash(preState),
            backtraceInfo.preTx.outputScriptList[STATE_OUTPUT_INDEX],
            prevoutsCtx.outputIndexVal
        )
        // check preTx script eq this locking script
        const preScript = spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)]
        // back to genesis
        Backtrace.verifyUnique(
            prevoutsCtx.spentTxhash,
            backtraceInfo,
            this.genesisOutpoint,
            preScript
        )

        // split to multiple minters
        let openMinterOutputs = toByteString('')
        let curStateHashes = toByteString('')
        let curStateCnt = 1n
        let mintCount = 0n
        for (let i = 0; i < MAX_NEXT_MINTERS; i++) {
            const count = nextMinterCounts[i]
            if (count > 0n) {
                mintCount += count
                curStateCnt += 1n
                openMinterOutputs += TxUtil.buildOutput(
                    preScript,
                    minterSatoshis
                )
                curStateHashes += hash160(
                    OpenMinterV2Proto.stateHash({
                        tokenScript: preState.tokenScript,
                        isPremined: true,
                        remainingSupplyCount: count,
                    })
                )
            }
        }
        // mint token
        curStateHashes += hash160(
            CAT20Proto.stateHash({
                amount: tokenMint.amount,
                ownerAddr: tokenMint.ownerAddr,
            })
        )
        const tokenOutput = TxUtil.buildOutput(
            preState.tokenScript,
            tokenSatoshis
        )
        if (!preState.isPremined && this.premine > 0n) {
            // premine need checksig
            assert(
                hash160(preminerPubKeyPrefix + preminerPubKey) ==
                    this.premineAddr
            )
            assert(this.checkSig(preminerSig, preminerPubKey))
            // first unlock mint
            assert(mintCount == preState.remainingSupplyCount)
            assert(
                this.maxCount ==
                    preState.remainingSupplyCount + this.premineCount
            )
            assert(tokenMint.amount == this.premine)
        } else {
            // not first unlock mint
            mintCount += 1n
            assert(mintCount == preState.remainingSupplyCount)
            assert(tokenMint.amount == this.limit)
        }
        const stateOutput = StateUtils.getCurrentStateOutput(
            curStateHashes,
            curStateCnt,
            curTxoStateHashes
        )
        const changeOutput = TxUtil.getChangeOutput(changeInfo)
        const hashOutputs = sha256(
            stateOutput + openMinterOutputs + tokenOutput + changeOutput
        )
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }
}
