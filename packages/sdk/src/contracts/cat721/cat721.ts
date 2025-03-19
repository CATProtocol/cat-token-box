import {
    assert,
    ByteString,
    hash160,
    Int32,
    len,
    method,
    OWNER_ADDR_CONTRACT_HASH_BYTE_LEN,
    prop,
    SmartContract,
} from '@scrypt-inc/scrypt-ts-btc';
import { BacktraceInfo } from '@scrypt-inc/scrypt-ts-btc';
import { ContractUnlockArgs } from '../types';
import { OwnerUtils } from '../utils/ownerUtils';
import { CAT721GuardStateLib } from './cat721GuardState';
import { CAT721StateLib } from './cat721State';
import { CAT721State, CAT721GuardConstState } from './types';

export class CAT721 extends SmartContract<CAT721State> {
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
        // guard
        guardInfo: CAT721GuardConstState,
        //
        guardInputIndex: Int32,
        //
        backtraceInfo: BacktraceInfo,
    ) {
        //
        this.backtraceToScript(backtraceInfo, this.minterScript);
        //
        CAT721StateLib.checkState(this.state);
        const cat721StateHash = CAT721StateLib.stateHash(this.state);
        // check guardInfo
        CAT721GuardStateLib.checkState(guardInfo);
        const guardStateHash = CAT721GuardStateLib.stateHash(guardInfo);
        this.checkInputState(guardInputIndex, guardStateHash);
        // check state of prevTx
        // make sure tx inputs contain a valid guard
        assert(this.ctx.spentScripts[Number(guardInputIndex)] == this.guardScript);
        this.checkGuardState(guardInfo, this.ctx.spentScript, cat721StateHash, this.ctx.inputIndexVal);

        if (len(this.state.ownerAddr) == OWNER_ADDR_CONTRACT_HASH_BYTE_LEN) {
            // unlock token owned by contract script
            assert(this.state.ownerAddr == hash160(this.ctx.spentScripts[Number(unlockArgs.contractInputIndexVal)]));
        } else {
            // unlock token owned by user key
            OwnerUtils.checkUserOwner(unlockArgs.userPubKeyPrefix, unlockArgs.userXOnlyPubKey, this.state.ownerAddr);
            assert(this.checkSig(unlockArgs.userSig, unlockArgs.userXOnlyPubKey));
        }
    }

    @method()
    checkGuardState(
        guardState: CAT721GuardConstState,
        // below params are all trustable
        cat721Script: ByteString,
        cat721StateHash: ByteString,
        cat721InputIndexVal: Int32,
    ): void {
        // guard state contains current token state hash
        assert(guardState.inputStateHashes[Number(cat721InputIndexVal)] == cat721StateHash);

        // guard state contains current token script
        // and the corresponding value of array tokenScripts and tokenScriptIndexes is correct
        const cat721ScriptIndex = guardState.nftScriptIndexes[Number(cat721InputIndexVal)];
        assert(guardState.nftScripts[Number(cat721ScriptIndex)] == cat721Script);
    }
}
