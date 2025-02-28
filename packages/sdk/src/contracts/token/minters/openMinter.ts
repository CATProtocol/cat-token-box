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
} from 'scrypt-ts';
import { BacktraceInfo, TxOut, int32, PrevoutsCtx, SHPreimage, SpentScriptsCtx, StateHashes } from '../../types';
import { CAT20State, OpenMinterState } from '../types';
import { ContextUtils } from '../../utils/contextUtils';
import { StateUtils } from '../../utils/stateUtils';
import { OpenMinterProto } from './openMinterProto';
import { Backtrace } from '../../utils/backtrace';
import { TxUtils } from '../../utils/txUtils';
import { CAT20Proto } from '../cat20Proto';
import { OwnerUtils } from '../../utils/ownerUtils';

const MAX_NEXT_MINTERS = 2;

export class OpenMinter extends SmartContract {
    @prop()
    genesisOutpoint: ByteString;

    // token max supply == this.maxCount * this.limit
    @prop()
    maxCount: int32;

    // this.premine == this.preminerCount * this.limit
    @prop()
    premine: int32;

    @prop()
    premineCount: int32;

    @prop()
    limit: int32;

    @prop()
    preminerAddr: ByteString;

    constructor(
        genesisOutpoint: ByteString,
        maxCount: int32,
        premine: int32,
        premineCount: int32,
        limit: int32,
        premineAddr: ByteString,
    ) {
        super(...arguments);
        this.genesisOutpoint = genesisOutpoint;
        this.maxCount = maxCount;
        // this assumes this.premineCount * this.limit == this.premine,
        // which can be trivially validated by anyone after the token is deployed
        this.premine = premine;
        this.premineCount = premineCount;
        this.limit = limit;
        this.preminerAddr = premineAddr;
    }

    @method()
    public mint(
        nextStateHashes: StateHashes,
        // args to mint token
        tokenMint: CAT20State,
        nextRemainingCounts: FixedArray<int32, typeof MAX_NEXT_MINTERS>,
        // premine related args
        preminerPubKeyPrefix: ByteString,
        preminerPubKey: PubKey,
        preminerSig: Sig,
        // output satoshis of curTx minter output
        minterSatoshis: ByteString,
        // output satoshis of curTx token output
        tokenSatoshis: ByteString,
        // state of current spending UTXO, comes from prevTx
        curState: OpenMinterState,
        curstateHashes: StateHashes,
        // backtrace
        backtraceInfo: BacktraceInfo,
        // curTx context
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
        // curTx change output
        changeInfo: TxOut,
    ) {
        // ctx
        // check sighash preimage
        assert(this.checkSig(ContextUtils.checkSHPreimage(shPreimage), ContextUtils.Gx), 'preimage check error');
        // check prevouts
        const inputCount = ContextUtils.checkPrevoutsCtx(prevoutsCtx, shPreimage.shaPrevouts, shPreimage.inputIndex);
        // check spent scripts
        ContextUtils.checkSpentScriptsCtx(spentScriptsCtx, shPreimage.shaSpentScripts, inputCount);

        // back to genesis
        const minterScript = spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)];
        Backtrace.verifyUnique(backtraceInfo, prevoutsCtx.prevTxHash, this.genesisOutpoint, minterScript);

        // check state of prevTx
        StateUtils.checkStateHash(
            curstateHashes,
            OpenMinterProto.stateHash(curState),
            backtraceInfo.prevTxPreimage.hashRoot,
            prevoutsCtx.prevOutputIndexVal,
        );

        let leadingStateRoots = toByteString('');
        let stateCount = 0n;

        // build curTx outputs

        // split to multiple next openMinters
        let minterOutputs = toByteString('');
        let sumNextRemainingCount = 0n;
        for (let i = 0; i < MAX_NEXT_MINTERS; i++) {
            const remainingCount = nextRemainingCounts[i];
            if (remainingCount > 0n) {
                sumNextRemainingCount += remainingCount;
                minterOutputs += TxUtils.buildOutput(minterScript, minterSatoshis);
                leadingStateRoots += hash160(
                    OpenMinterProto.stateHash({
                        tokenScript: curState.tokenScript,
                        hasMintedBefore: true,
                        remainingCount,
                    }),
                );
                stateCount++;
            }
        }

        // next token output
        const tokenOutput = TxUtils.buildOutput(curState.tokenScript, tokenSatoshis);
        leadingStateRoots += hash160(CAT20Proto.stateHash(tokenMint));
        stateCount++;
        if (!curState.hasMintedBefore && this.premine > 0n) {
            // needs to premine
            assert(this.maxCount == curState.remainingCount + this.premineCount);
            // preminer checksig
            OwnerUtils.checkUserOwner(preminerPubKeyPrefix, preminerPubKey, this.preminerAddr);
            assert(this.checkSig(preminerSig, preminerPubKey));
            // premine dees not affect curState.remainingCount
            assert(sumNextRemainingCount == curState.remainingCount);
            assert(tokenMint.amount == this.premine);
        } else {
            // general mint
            if (!curState.hasMintedBefore) {
                // this is the first time mint
                assert(this.maxCount == curState.remainingCount);
                assert(this.premineCount == 0n);
                assert(this.premine == 0n);
            }
            assert(sumNextRemainingCount == curState.remainingCount - 1n);
            assert(tokenMint.amount == this.limit);
        }

        // state hash root output
        const hashRootOutput = StateUtils.buildStateHashRootOutput(leadingStateRoots, stateCount, nextStateHashes);
        // change output
        const changeOutput = TxUtils.buildChangeOutput(changeInfo);

        // confine curTx outputs
        const shaOutputs = sha256(hashRootOutput + minterOutputs + tokenOutput + changeOutput);
        assert(shaOutputs == shPreimage.shaOutputs, 'shaOutputs mismatch');
    }
}
