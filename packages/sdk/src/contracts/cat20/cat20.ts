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
import { ContractUnlockArgs } from '../types';
import { OwnerUtils } from '../utils/ownerUtils';
import { CAT20GuardConstState, CAT20State } from './types';
import { CAT20StateLib } from './cat20State';
import { CAT20GuardStateLib } from './cat20GuardState';
import { BacktraceInfo } from '@scrypt-inc/scrypt-ts-btc';

export class CAT20 extends SmartContract<CAT20State> {
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
        guardState: CAT20GuardConstState,
        //
        guardInputIndex: Int32,
        //
        backtraceInfo: BacktraceInfo,
    ) {
        //
        this.backtraceToScript(backtraceInfo, this.minterScript);
        //
        CAT20StateLib.checkState(this.state);
        const cat20StateHash = CAT20StateLib.stateHash(this.state);
        // check guardInfo
        CAT20GuardStateLib.checkState(guardState);
        const guardStateHash = CAT20GuardStateLib.stateHash(guardState);
        this.checkInputState(guardInputIndex, guardStateHash);
        // check state of prevTx
        // make sure tx inputs contain a valid guard
        assert(this.ctx.spentScripts[Number(guardInputIndex)] == this.guardScript);
        this.checkGuardState(guardState, this.ctx.spentScript, cat20StateHash, this.ctx.inputIndexVal);

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
        guardState: CAT20GuardConstState,
        // below params are all trustable
        cat20Script: ByteString,
        cat20StateHash: ByteString,
        cat20InputIndexVal: Int32,
    ): void {
        // guard state contains current token state hash
        assert(guardState.inputStateHashes[Number(cat20InputIndexVal)] == cat20StateHash);

        // guard state contains current token script
        // and the corresponding value of array tokenScripts and tokenScriptIndexes is correct
        const tokenScriptIndex = guardState.tokenScriptIndexes[Number(cat20InputIndexVal)];
        assert(guardState.tokenScripts[Number(tokenScriptIndex)] == cat20Script);
    }
}
