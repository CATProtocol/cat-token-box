import {
    ByteString,
    FixedArray,
    SmartContract,
    assert,
    hash160,
    len,
    method,
    sha256,
    toByteString,
} from 'scrypt-ts'
import { PrevoutsCtx, SHPreimage, SigHashUtils } from '../utils/sigHashUtils'
import { MAX_STATE, MAX_TOKEN_OUTPUT, TxUtil } from '../utils/txUtil'
import { XrayedTxIdPreimg3 } from '../utils/txProof'
import { NftGuardConstState, NftGuardProto } from './nftGuardProto'
import { StateUtils, TxoStateHashes } from '../utils/stateUtils'

export class NftBurnGuard extends SmartContract {
    @method()
    public burn(
        curTxoStateHashes: TxoStateHashes,
        outputScriptList: FixedArray<ByteString, typeof MAX_TOKEN_OUTPUT>,
        outputSatoshisList: FixedArray<ByteString, typeof MAX_TOKEN_OUTPUT>,
        // verify preTx data part
        preState: NftGuardConstState,
        // check deploy tx
        preTx: XrayedTxIdPreimg3,
        //
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx
    ) {
        // Check sighash preimage.
        assert(
            this.checkSig(
                SigHashUtils.checkSHPreimage(shPreimage),
                SigHashUtils.Gx
            ),
            'preimage check error'
        )
        SigHashUtils.checkPrevoutsCtx(
            prevoutsCtx,
            shPreimage.hashPrevouts,
            shPreimage.inputIndex
        )
        // check preTx
        StateUtils.verifyGuardStateHash(
            preTx,
            prevoutsCtx.spentTxhash,
            NftGuardProto.stateHash(preState)
        )
        let stateHashString = toByteString('')
        let outputs = toByteString('')
        for (let i = 0; i < MAX_STATE; i++) {
            const outputScript = outputScriptList[i]
            // output note equal token locking script
            assert(outputScript != preState.collectionScript)
            stateHashString += hash160(curTxoStateHashes[i])
            if (len(outputScript) > 0) {
                outputs += TxUtil.buildOutput(
                    outputScript,
                    outputSatoshisList[i]
                )
            }
        }
        const stateOutput = TxUtil.buildOpReturnRoot(
            TxUtil.getStateScript(hash160(stateHashString))
        )
        const hashOutputs = sha256(stateOutput + outputs)
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }
}
