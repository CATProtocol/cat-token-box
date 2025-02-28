import { ByteString, SmartContract, prop, method, assert, hash160, len } from 'scrypt-ts';
import { CAT721Proto } from './cat721Proto';
import { NftGuardProto } from './nftGuardProto';
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
import { Backtrace } from '../utils/backtrace';
import { OWNER_ADDR_CONTRACT_HASH_BYTE_LEN } from '../constants';
import { CAT721State, NftGuardInfo } from './types';
import { TxUtils } from '../utils/txUtils';
import { OwnerUtils } from '../utils/ownerUtils';

export class CAT721 extends SmartContract {
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
        curState: CAT721State,
        curStateHashes: StateHashes,
        // guard
        guardInfo: NftGuardInfo,
        // backtrace
        backtraceInfo: BacktraceInfo,
        // curTx context
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
    ) {
        // ctx
        // check sighash preimage
        assert(this.checkSig(ContextUtils.checkSHPreimage(shPreimage), ContextUtils.Gx), 'preimage check error');
        // check prevouts
        const inputCount = ContextUtils.checkPrevoutsCtx(prevoutsCtx, shPreimage.shaPrevouts, shPreimage.inputIndex);
        // check spent scripts
        ContextUtils.checkSpentScriptsCtx(spentScriptsCtx, shPreimage.shaSpentScripts, inputCount);

        // back to genesis
        const nftScript = spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)];
        Backtrace.verifyToken(backtraceInfo, prevoutsCtx.prevTxHash, this.minterScript, nftScript);

        // check state of prevTx
        const curStateHash = CAT721Proto.stateHash(curState);
        StateUtils.checkStateHash(
            curStateHashes,
            curStateHash,
            backtraceInfo.prevTxPreimage.hashRoot,
            prevoutsCtx.prevOutputIndexVal,
        );

        // make sure tx inputs contain a valid guard
        this.checkGuard(
            guardInfo,
            nftScript,
            curStateHash,
            prevoutsCtx.inputIndexVal,
            prevoutsCtx.prevouts,
            spentScriptsCtx,
        );

        if (len(curState.ownerAddr) == OWNER_ADDR_CONTRACT_HASH_BYTE_LEN) {
            // unlock nft owned by contract script
            assert(curState.ownerAddr == hash160(spentScriptsCtx[Number(unlockArgs.contractInputIndexVal)]));
        } else {
            // unlock nft owned by user key
            OwnerUtils.checkUserOwner(unlockArgs.userPubKeyPrefix, unlockArgs.userXOnlyPubKey, curState.ownerAddr);
            assert(this.checkSig(unlockArgs.userSig, unlockArgs.userXOnlyPubKey));
        }
    }

    @method()
    checkGuard(
        guardInfo: NftGuardInfo,
        // below params are all trustable
        nftScript: ByteString,
        nftStateHash: ByteString,
        nftInputIndexVal: int32,
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
            NftGuardProto.stateHash(guardInfo.curState),
            prevouts[Number(guardInfo.inputIndexVal)],
        );

        // guard script in curTx matches the pre-saved guard script property in the nft contract
        assert(spentScriptsCtx[Number(guardInfo.inputIndexVal)] == this.guardScript);

        // guard state contains current nft state hash
        assert(guardInfo.curState.inputStateHashes[Number(nftInputIndexVal)] == nftStateHash);

        // guard state contains current nft script
        // and the corresponding value of array nftScripts and nftScriptIndexes is correct
        const nftScriptIndex = guardInfo.curState.nftScriptIndexes[Number(nftInputIndexVal)];
        assert(guardInfo.curState.nftScripts[Number(nftScriptIndex)] == nftScript);
    }
}
