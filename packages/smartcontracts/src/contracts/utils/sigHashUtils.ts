import {
    ByteString,
    FixedArray,
    PubKey,
    Sig,
    SmartContractLib,
    assert,
    int2ByteString,
    method,
    prop,
    sha256,
    toByteString,
} from 'scrypt-ts'
import { MAX_INPUT, TxUtil, int32 } from './txUtil'

export type SHPreimage = {
    txVer: ByteString
    nLockTime: ByteString
    hashPrevouts: ByteString
    hashSpentAmounts: ByteString
    hashSpentScripts: ByteString
    hashSequences: ByteString
    hashOutputs: ByteString
    spendType: ByteString
    inputIndex: ByteString
    hashTapLeaf: ByteString
    keyVer: ByteString
    codeSeparator: ByteString
    _e: ByteString // e without last byte
    eLastByte: int32
}

export type PrevoutsCtx = {
    prevouts: FixedArray<ByteString, typeof MAX_INPUT>
    inputIndexVal: int32
    outputIndexVal: int32
    spentTxhash: ByteString
    outputIndex: ByteString
}

export type SpentScriptsCtx = FixedArray<ByteString, typeof MAX_INPUT>

export class SigHashUtils extends SmartContractLib {
    // Data for checking sighash preimage:
    @prop()
    static readonly Gx: PubKey = PubKey(
        toByteString(
            '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
        )
    )
    @prop()
    static readonly ePreimagePrefix: ByteString = toByteString(
        '7bb52d7a9fef58323eb1bf7a407db382d2f3f2d81bb1224f49fe518f6d48d37c7bb52d7a9fef58323eb1bf7a407db382d2f3f2d81bb1224f49fe518f6d48d37c79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f8179879be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
    ) // TAG_HASH + TAG_HASH + Gx + Gx
    @prop()
    static readonly preimagePrefix: ByteString = toByteString(
        'f40a48df4b2a70c8b4924bf2654661ed3d95fd66a313eb87237597c628e4a031f40a48df4b2a70c8b4924bf2654661ed3d95fd66a313eb87237597c628e4a0310000'
    ) // TAPSIGHASH + TAPSIGHASH + PREIMAGE_SIGHASH + PREIMAGE_EPOCH

    @method()
    static checkSHPreimage(shPreimage: SHPreimage): Sig {
        const sigHash = sha256(
            SigHashUtils.preimagePrefix +
                shPreimage.txVer +
                shPreimage.nLockTime +
                shPreimage.hashPrevouts +
                shPreimage.hashSpentAmounts +
                shPreimage.hashSpentScripts +
                shPreimage.hashSequences +
                shPreimage.hashOutputs +
                shPreimage.spendType +
                shPreimage.inputIndex +
                shPreimage.hashTapLeaf +
                shPreimage.keyVer +
                shPreimage.codeSeparator
        )

        const e = sha256(SigHashUtils.ePreimagePrefix + sigHash)
        assert(shPreimage.eLastByte < 127n, 'invalid value of _e')
        const eLastByte =
            shPreimage.eLastByte == 0n
                ? toByteString('00')
                : int2ByteString(shPreimage.eLastByte)
        assert(e == shPreimage._e + eLastByte, 'invalid value of _e')
        const s =
            SigHashUtils.Gx +
            shPreimage._e +
            int2ByteString(shPreimage.eLastByte + 1n)
        //assert(this.checkSig(Sig(s), SigHashUtils.Gx)) TODO (currently done outside)
        return Sig(s)
    }

    @method()
    static checkPrevoutsCtx(
        prevoutsCtx: PrevoutsCtx,
        hashPrevouts: ByteString,
        inputIndex: ByteString
    ): boolean {
        // check prevouts
        assert(
            sha256(TxUtil.mergePrevouts(prevoutsCtx.prevouts)) == hashPrevouts,
            'hashPrevouts mismatch'
        )
        // check input index
        assert(TxUtil.checkIndex(prevoutsCtx.inputIndexVal, inputIndex))
        // check vout
        assert(
            TxUtil.checkIndex(
                prevoutsCtx.outputIndexVal,
                prevoutsCtx.outputIndex
            )
        )
        // check prevout
        assert(
            prevoutsCtx.prevouts[Number(prevoutsCtx.inputIndexVal)] ==
                prevoutsCtx.spentTxhash + prevoutsCtx.outputIndex
            // 'input outpoint mismatch'
        )
        return true
    }

    @method()
    static checkSpentScriptsCtx(
        spentScripts: SpentScriptsCtx,
        hashSpentScripts: ByteString
    ): boolean {
        // check spent scripts
        assert(
            sha256(TxUtil.mergeSpentScripts(spentScripts)) == hashSpentScripts,
            'hashSpentScripts mismatch'
        )
        return true
    }
}
