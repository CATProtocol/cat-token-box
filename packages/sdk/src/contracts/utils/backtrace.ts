import { assert, SmartContractLib, method, ByteString } from 'scrypt-ts';
import { BacktraceInfo } from '../types';
import { TxProof } from './txProof';
import { TxUtils } from './txUtils';

type ChainTxVerifyResponse = {
    prevPrevScript: ByteString;
    prevPrevOutpoint: ByteString;
};

export class Backtrace extends SmartContractLib {
    /**
     * Back-to-genesis backtrace verification for the unique contract
     * @param backtraceInfo backtrace info to verify, including prevTx and prevPrevTx preimages
     * @param prevTxHash prevTxHash from context prevouts of curTx which is trustable
     * @param genesisOutpoint genesis outpoint of the contract which is a contract property and trustable
     * @param expectedScript locking script of the currect spending UTXO which is trustable
     */
    @method()
    static verifyUnique(
        backtraceInfo: BacktraceInfo,
        prevTxHash: ByteString,
        genesisOutpoint: ByteString,
        expectedScript: ByteString,
    ): void {
        const res = Backtrace.verifyChainTxs(backtraceInfo, prevTxHash);
        if (res.prevPrevOutpoint != genesisOutpoint) {
            assert(res.prevPrevScript == expectedScript);
        }
    }

    /**
     * Back-to-genesis backtrace verification for the token contract
     * @param backtraceInfo backtrace info to verify, including prevTx and prevPrevTx preimages
     * @param prevTxHash prevTxHash from context prevouts of curTx which is trustable
     * @param minterScript expected minter locking script which is a contract property and trustable
     * @param tokenScript expected token locking script which comes from the current spending UTXO context and is trustable
     */
    @method()
    static verifyToken(
        backtraceInfo: BacktraceInfo,
        prevTxHash: ByteString,
        minterScript: ByteString,
        tokenScript: ByteString,
    ): void {
        const res = Backtrace.verifyChainTxs(backtraceInfo, prevTxHash);
        assert(res.prevPrevScript == minterScript || res.prevPrevScript == tokenScript);
    }

    /**
     * Tx chain verification to ensure:
     *   1. the current spending UTXO is the output of prevTx
     *   2. the specific input of prevTx is the output of prevPrevTx
     * @param backtraceInfo backtrace info to verify, including prevTx and prevPrevTx preimages
     * @param prevTxHash prevTxHash from context prevouts of curTx which is trustable
     * @returns locking script and outpoint of the specified output of prevPrevTx
     */
    @method()
    static verifyChainTxs(backtraceInfo: BacktraceInfo, prevTxHash: ByteString): ChainTxVerifyResponse {
        // check if prevTxHash of current spending UTXO and prevTx are matched
        assert(prevTxHash == TxProof.getTxHashFromPreimage2(backtraceInfo.prevTxPreimage));
        // check if the passed prevTxInput and prevTxInputIndexVal are matched
        const prevTxInput = backtraceInfo.prevTxPreimage.inputList[Number(backtraceInfo.prevTxInputIndexVal)];
        assert(prevTxInput == TxUtils.mergeInput(backtraceInfo.prevTxInput));
        // check if prevTxHash of passed prevTxInput and prevPrevTx are matched
        const prevPrevTxHash = backtraceInfo.prevTxInput.prevTxHash;
        assert(prevPrevTxHash == TxProof.getTxHashFromPreimage1(backtraceInfo.prevPrevTxPreimage));
        // all fields in backtraceInfo have been verified
        const prevPrevOutputIndex = backtraceInfo.prevTxInput.prevOutputIndexVal;
        const prevPrevScript = backtraceInfo.prevPrevTxPreimage.outputScriptList[Number(prevPrevOutputIndex)];
        const prevPrevOutpoint = prevPrevTxHash + backtraceInfo.prevTxInput.prevOutputIndex;
        return { prevPrevScript, prevPrevOutpoint };
    }
}
