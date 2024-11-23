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
import { OpenMinterProto, OpenMinterState } from './openMinterProto'

export const MAX_NEXT_MINTERS = 2

export class OpenMinter extends SmartContract {
    @prop()
    genesisOutpoint: ByteString

    @prop()
    max: int32

    @prop()
    premine: int32

    @prop()
    limit: int32

    @prop()
    premineAddr: ByteString

    constructor(
        genesisOutpoint: ByteString,
        max: int32,
        premine: int32,
        limit: int32,
        premineAddr: ByteString
    ) {
        super(...arguments)
        this.genesisOutpoint = genesisOutpoint
        this.max = max
        this.premine = premine
        this.limit = limit
        this.premineAddr = premineAddr
    }

    @method()
    public mint(
        //
        curTxoStateHashes: TxoStateHashes,
        // contract logic args
        tokenMint: CAT20State,
        nextMinterAmounts: FixedArray<int32, typeof MAX_NEXT_MINTERS>,

        // premine related args
        preminerPubKeyPrefix: ByteString,
        preminerPubKey: PubKey,
        preminerSig: Sig,

        // satoshis locked in minter utxo
        minterSatoshis: ByteString,
        // satoshis locked in token utxo
        tokenSatoshis: ByteString,
        // unlock utxo state info
        preState: OpenMinterState,
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
            OpenMinterProto.stateHash(preState),
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
        let curStateCnt = 0n
        let totalAmount = 0n
        for (let i = 0; i < MAX_NEXT_MINTERS; i++) {
            const amount = nextMinterAmounts[i]
            if (amount > 0n) {
                totalAmount += amount
                curStateCnt += 1n
                openMinterOutputs += TxUtil.buildOutput(
                    preScript,
                    minterSatoshis
                )
                curStateHashes += hash160(
                    OpenMinterProto.stateHash({
                        tokenScript: preState.tokenScript,
                        isPremined: true,
                        remainingSupply: amount,
                    })
                )
            }
        }
        // mint token
        let tokenOutput = toByteString('')
        if (tokenMint.amount > 0n) {
            totalAmount += tokenMint.amount
            curStateCnt += 1n
            curStateHashes += hash160(
                CAT20Proto.stateHash({
                    amount: tokenMint.amount,
                    ownerAddr: tokenMint.ownerAddr,
                })
            )
            tokenOutput = TxUtil.buildOutput(
                preState.tokenScript,
                tokenSatoshis
            )
        }
        if (!preState.isPremined && this.premine > 0n) {
            // premine need checksig
            assert(
                hash160(preminerPubKeyPrefix + preminerPubKey) ==
                    this.premineAddr
            )
            assert(this.checkSig(preminerSig, preminerPubKey))
            // first unlock mint
            assert(totalAmount == preState.remainingSupply + this.premine)
            assert(this.max == preState.remainingSupply + this.premine)
            assert(tokenMint.amount == this.premine)
        } else {
            // not first unlock mint
            assert(totalAmount == preState.remainingSupply)
            assert(tokenMint.amount <= this.limit)
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
