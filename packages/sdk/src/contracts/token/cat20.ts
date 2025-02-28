import { ByteString, SmartContract, prop, method, assert, hash160, len } from 'scrypt-ts';
import { OwnerUtils } from '../utils/ownerUtils';
import { CAT20State, GuardInfo } from './types';
import {
    BacktraceInfo,
    ContractUnlockArgs,
    int32,
    Prevouts,
    PrevoutsCtx,
    SHPreimage,
    SpentScriptsCtx,
    StateHashes,
} from '../types';
import { ContextUtils } from '../utils/contextUtils';
import { StateUtils } from '../utils/stateUtils';
import { CAT20Proto } from './cat20Proto';
import { Backtrace } from '../utils/backtrace';
import { OWNER_ADDR_CONTRACT_HASH_BYTE_LEN } from '../constants';
import { GuardProto } from './guardProto';
import { TxUtils } from '../utils/txUtils';

export class CAT20 extends SmartContract {
    @prop()
    minterScript: ByteString;

    @prop()
    guardScript: ByteString;

    constructor(minterScript: ByteString, guardScript: ByteString) {
        super(...arguments);
        this.minterScript = minterScript;
        this.guardScript = guardScript;
    }

    @method()
    public unlock(
        unlockArgs: ContractUnlockArgs,
        // state of current spending UTXO, comes from prevTx
        curState: CAT20State,
        curStateHashes: StateHashes,
        // guard
        guardInfo: GuardInfo,
        // backtrace
        backtraceInfo: BacktraceInfo,
        // curTx context
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
    ) {
        // ctx
        // check sighash preimage
        assert(
            this.checkSig(ContextUtils.checkSHPreimage(shPreimage), ContextUtils.Gx),
            'sighash preimage check error',
        );
        // check prevouts
        const inputCount = ContextUtils.checkPrevoutsCtx(prevoutsCtx, shPreimage.shaPrevouts, shPreimage.inputIndex);
        // check spent scripts
        ContextUtils.checkSpentScriptsCtx(spentScriptsCtx, shPreimage.shaSpentScripts, inputCount);

        // back to genesis
        const tokenScript = spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)];
        Backtrace.verifyToken(backtraceInfo, prevoutsCtx.prevTxHash, this.minterScript, tokenScript);

        // check state of prevTx
        const curStateHash = CAT20Proto.stateHash(curState);
        StateUtils.checkStateHash(
            curStateHashes,
            curStateHash,
            backtraceInfo.prevTxPreimage.hashRoot,
            prevoutsCtx.prevOutputIndexVal,
        );

        // make sure tx inputs contain a valid guard
        this.checkGuard(
            guardInfo,
            tokenScript,
            curStateHash,
            prevoutsCtx.inputIndexVal,
            prevoutsCtx.prevouts,
            spentScriptsCtx,
        );

        if (len(curState.ownerAddr) == OWNER_ADDR_CONTRACT_HASH_BYTE_LEN) {
            // unlock token owned by contract script
            assert(curState.ownerAddr == hash160(spentScriptsCtx[Number(unlockArgs.contractInputIndexVal)]));
        } else {
            // unlock token owned by user key
            OwnerUtils.checkUserOwner(unlockArgs.userPubKeyPrefix, unlockArgs.userXOnlyPubKey, curState.ownerAddr);
            assert(this.checkSig(unlockArgs.userSig, unlockArgs.userXOnlyPubKey));
        }
    }

    @method()
    checkGuard(
        guardInfo: GuardInfo,
        // below params are all trustable
        tokenScript: ByteString,
        tokenStateHash: ByteString,
        tokenInputIndexVal: int32,
        prevouts: Prevouts,
        spentScriptsCtx: SpentScriptsCtx,
    ): void {
        // check guardInfo
        TxUtils.checkIndex(guardInfo.prevOutputIndexVal, guardInfo.prevOutputIndex);
        StateUtils.checkInputState(
            {
                prevTxPreimage: guardInfo.prevTxPreimage,
                prevOutputIndexVal: guardInfo.prevOutputIndexVal,
                stateHashes: guardInfo.curStateHashes,
            },
            GuardProto.stateHash(guardInfo.curState),
            prevouts[Number(guardInfo.inputIndexVal)],
        );

        // guard script in curTx matches the pre-saved guard script property in the token contract
        assert(spentScriptsCtx[Number(guardInfo.inputIndexVal)] == this.guardScript);

        // guard state contains current token state hash
        assert(guardInfo.curState.inputStateHashes[Number(tokenInputIndexVal)] == tokenStateHash);

        // guard state contains current token script
        // and the corresponding value of array tokenScripts and tokenScriptIndexes is correct
        const tokenScriptIndex = guardInfo.curState.tokenScriptIndexes[Number(tokenInputIndexVal)];
        assert(guardInfo.curState.tokenScripts[Number(tokenScriptIndex)] == tokenScript);
    }
}
