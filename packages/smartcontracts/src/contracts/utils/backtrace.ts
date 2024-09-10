import { assert, SmartContractLib, method, ByteString } from 'scrypt-ts'
import {
    XrayedTxIdPreimg1,
    XrayedTxIdPreimg2,
    TxInput,
    TxProof,
} from './txProof'
import { TxUtil, int32 } from './txUtil'

export type BacktraceInfo = {
    // preTx
    preTx: XrayedTxIdPreimg1
    preTxInput: TxInput
    preTxInputIndex: int32
    // prePreTx
    prePreTx: XrayedTxIdPreimg2
}

export class Backtrace extends SmartContractLib {
    @method()
    static verifyUnique(
        preTxid: ByteString,
        backtraceInfo: BacktraceInfo,
        genesisOutpoint: ByteString,
        expectedScript: ByteString
    ): boolean {
        // verify tx id
        assert(preTxid == TxProof.getTxIdFromPreimg1(backtraceInfo.preTx))
        assert(
            TxProof.mergeInput(backtraceInfo.preTxInput) ==
                backtraceInfo.preTx.inputs[
                    Number(backtraceInfo.preTxInputIndex)
                ]
        )
        assert(
            TxUtil.checkIndex(
                backtraceInfo.preTxInput.outputIndexVal,
                backtraceInfo.preTxInput.outputIndex
            )
        )
        // verify the specified output of prevTx is an input of tx
        const prevOutpoint =
            backtraceInfo.preTxInput.txhash +
            backtraceInfo.preTxInput.outputIndex
        if (prevOutpoint != genesisOutpoint) {
            // check if prevTx's script code is same with scriptCodeHash
            TxProof.verifyOutput(
                backtraceInfo.prePreTx,
                backtraceInfo.preTxInput.txhash,
                backtraceInfo.preTxInput.outputIndexVal,
                expectedScript
            )
        }
        return true
    }

    @method()
    static verifyToken(
        preTxid: ByteString,
        backtraceInfo: BacktraceInfo,
        minterScript: ByteString,
        expectedScript: ByteString
    ): boolean {
        // verify tx id
        assert(preTxid == TxProof.getTxIdFromPreimg1(backtraceInfo.preTx))
        assert(
            TxProof.mergeInput(backtraceInfo.preTxInput) ==
                backtraceInfo.preTx.inputs[
                    Number(backtraceInfo.preTxInputIndex)
                ]
        )
        assert(
            TxUtil.checkIndex(
                backtraceInfo.preTxInput.outputIndexVal,
                backtraceInfo.preTxInput.outputIndex
            )
        )
        assert(
            TxProof.getTxIdFromPreimg2(backtraceInfo.prePreTx) ==
                backtraceInfo.preTxInput.txhash
        )
        const prePreScript =
            backtraceInfo.prePreTx.outputScriptList[
                Number(backtraceInfo.preTxInput.outputIndexVal)
            ]
        const backtraceGenesis = prePreScript == minterScript
        // backtrace to token contract
        const backtraceToken = prePreScript == expectedScript
        assert(backtraceGenesis || backtraceToken)
        return true
    }
}
