import {
    ByteString,
    FixedArray,
    SmartContract,
    assert,
    fill,
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
import { NftGuardConstState, NftGuardProto } from './nftGuardProto'
import { StateUtils, TxoStateHashes } from '../utils/stateUtils'

export class NftTransferGuard extends SmartContract {
    @method()
    public transfer(
        curTxoStateHashes: TxoStateHashes,
        // nft owner address or other output locking script
        ownerAddrOrScriptList: FixedArray<ByteString, typeof MAX_TOKEN_OUTPUT>,
        localIdList: FixedArray<int32, typeof MAX_TOKEN_OUTPUT>,
        nftOutputMaskList: FixedArray<boolean, typeof MAX_TOKEN_OUTPUT>,
        outputSatoshisList: FixedArray<ByteString, typeof MAX_TOKEN_OUTPUT>,
        nftSatoshis: ByteString,

        // verify preTx data part
        preState: NftGuardConstState,
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
            NftGuardProto.stateHash(preState)
        )
        // sum input amount
        const localIdArray: FixedArray<int32, typeof MAX_TOKEN_OUTPUT> = fill(
            -1n,
            MAX_TOKEN_OUTPUT
        )
        let localIdArrayIndex = 0n
        for (let i = 0; i < MAX_INPUT; i++) {
            const script = spentScripts[i]
            if (script == preState.collectionScript) {
                localIdArray[Number(localIdArrayIndex)] =
                    preState.localIdArray[i]
                localIdArrayIndex += 1n
            }
        }
        let stateHashString = toByteString('')
        let outputs = toByteString('')
        let outputLocalIdArrayIndex = 0n
        const nftOutput = TxUtil.buildOutput(
            preState.collectionScript,
            nftSatoshis
        )
        // sum output amount, build nft outputs, build nft state hash
        for (let i = 0; i < MAX_STATE; i++) {
            const addrOrScript = ownerAddrOrScriptList[i]
            if (nftOutputMaskList[i]) {
                // nft owner address
                const localId = localIdArray[Number(outputLocalIdArrayIndex)]
                outputs = outputs + nftOutput
                const nftStateHash = hash160(
                    hash160(addrOrScript + int2ByteString(localId))
                )
                assert(hash160(curTxoStateHashes[i]) == nftStateHash)
                assert(localId >= 0n)
                assert(localIdList[i] == localId)
                stateHashString += nftStateHash
                outputLocalIdArrayIndex += 1n
            } else {
                // other output locking script
                assert(addrOrScript != preState.collectionScript)
                stateHashString += hash160(curTxoStateHashes[i])
                if (len(addrOrScript) > 0) {
                    outputs += TxUtil.buildOutput(
                        addrOrScript,
                        outputSatoshisList[i]
                    )
                }
            }
        }
        assert(localIdArrayIndex == outputLocalIdArrayIndex)
        const stateOutput = TxUtil.buildOpReturnRoot(
            TxUtil.getStateScript(hash160(stateHashString))
        )
        const hashOutputs = sha256(stateOutput + outputs)
        assert(hashOutputs == shPreimage.hashOutputs, 'hashOutputs mismatch')
    }
}
