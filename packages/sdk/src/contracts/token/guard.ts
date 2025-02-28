import {
    ByteString,
    FixedArray,
    SmartContract,
    assert,
    fill,
    hash160,
    len,
    method,
    sha256,
    toByteString,
} from 'scrypt-ts';
import { InputStateProof, int32, PrevoutsCtx, SHPreimage, SpentScriptsCtx, StateHashes } from '../types';
import {
    TX_INPUT_COUNT_MAX,
    STATE_OUTPUT_COUNT_MAX,
    GUARD_TOKEN_TYPE_MAX,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
} from '../constants';
import { CAT20State, GuardConstState } from './types';
import { ContextUtils } from '../utils/contextUtils';
import { GuardProto } from './guardProto';
import { SafeMath } from '../utils/safeMath';
import { CAT20Proto } from './cat20Proto';
import { TxUtils } from '../utils/txUtils';
import { StateUtils } from '../utils/stateUtils';

export class Guard extends SmartContract {
    @method()
    public unlock(
        nextStateHashes: StateHashes,
        // for each curTx output except the state hash root output,
        // if it is a token output, the value is token owner address of this output,
        // otherwise, the value is the locking script of this output
        ownerAddrOrScripts: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
        // for each curTx output except the state hash root output,
        // if it is a token output, the value is the token amount of this output,
        // otherwise, the value is 0 by default
        outputTokens: FixedArray<int32, typeof STATE_OUTPUT_COUNT_MAX>,
        // for each curTx output except the state hash root output,
        // if it is a token output,
        // the value marks the index of the token script used by this output in the tokenScripts,
        // otherwise, the value is -1 by default
        // this logic is the same as tokenScriptIndexes in GuardConstState which is used for token inputs
        tokenScriptIndexes: FixedArray<int32, typeof STATE_OUTPUT_COUNT_MAX>,
        // output satoshi of each curTx output except the state hash root output
        outputSatoshis: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
        // for each curTx input,
        // if it is a contract input, the value is the input state proof of this input,
        // otherwise, the value is an empty proof by default
        inputStateProofs: FixedArray<InputStateProof, typeof TX_INPUT_COUNT_MAX>,
        // for each curTx input,
        // if it is a token input, the value is the raw state of this input,
        // otherwise, the value is an empty state by default
        cat20States: FixedArray<CAT20State, typeof TX_INPUT_COUNT_MAX>,
        // guard state of current spending UTXO
        curState: GuardConstState,
        // the number of curTx outputs except for the state hash root output
        outputCount: int32,
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

        const curStateHash = GuardProto.stateHash(curState);
        const curInputIndexVal = prevoutsCtx.inputIndexVal;
        // inputStateHashes in guard state cannot contain the guard state hash itself
        assert(curState.inputStateHashes[Number(curInputIndexVal)] == toByteString(''));
        // check input state proof for each curTx input
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const inputStateHash = BigInt(i) == curInputIndexVal ? curStateHash : curState.inputStateHashes[i];
            if (i < inputCount) {
                StateUtils.checkInputState(inputStateProofs[i], inputStateHash, prevoutsCtx.prevouts[i]);
            } else {
                // ensure the placeholders are empty
                assert(curState.inputStateHashes[i] == toByteString(''));
                assert(curState.tokenScriptIndexes[i] == -1n);
            }
        }

        // how many different types of tokens in curTx inputs
        let inputTokenTypes = 0n;
        const tokenScriptPlaceholders: FixedArray<ByteString, typeof GUARD_TOKEN_TYPE_MAX> = [
            toByteString('ff'),
            toByteString('fe'),
            toByteString('fd'),
            toByteString('fc'),
        ];
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            if (curState.tokenScripts[i] != tokenScriptPlaceholders[i]) {
                inputTokenTypes++;
            }
        }
        // ensure there are no placeholders between valid token scripts in curState.tokenScripts
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            if (i < Number(inputTokenTypes)) {
                assert(curState.tokenScripts[i] != tokenScriptPlaceholders[i]);
                assert(len(curState.tokenScripts[i]) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
            } else {
                assert(curState.tokenScripts[i] == tokenScriptPlaceholders[i]);
            }
        }
        assert(inputTokenTypes > 0n);

        // inputTokenTypes here is not trustable yet
        // user could append token scripts in curState.tokenScripts that are not used in curTx inputs

        // sum token input amount, data comes from cat20 raw states passed in by the user
        const sumInputTokens = fill(0n, GUARD_TOKEN_TYPE_MAX);
        let tokenScriptIndexMax = -1n;
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const tokenScriptIndex = curState.tokenScriptIndexes[Number(i)];
            assert(tokenScriptIndex < inputTokenTypes);
            if (tokenScriptIndex != -1n) {
                // this is a token input
                const tokenScript = curState.tokenScripts[Number(tokenScriptIndex)];
                assert(tokenScript == spentScriptsCtx[i]);
                assert(curState.inputStateHashes[i] == CAT20Proto.stateHash(cat20States[i]));
                sumInputTokens[Number(tokenScriptIndex)] = SafeMath.add(
                    sumInputTokens[Number(tokenScriptIndex)],
                    cat20States[i].amount,
                );
                tokenScriptIndexMax = tokenScriptIndex > tokenScriptIndexMax ? tokenScriptIndex : tokenScriptIndexMax;
            }
        }
        // verify inputTokenTypes by tokenScriptIndexMax
        // tokenScriptIndexMax is trustable because it is calculated after going through all the curTx inputs
        // this also ensures that there is at least one token input in curTx
        assert(tokenScriptIndexMax >= 0n && tokenScriptIndexMax == inputTokenTypes - 1n);

        // sum token output amount, data comes from outputTokens passed in by the user
        // and build curTx outputs and stateRoots as well
        assert(outputCount >= 0n && outputCount <= STATE_OUTPUT_COUNT_MAX);
        const sumOutputTokens = fill(0n, GUARD_TOKEN_TYPE_MAX);
        let outputs = toByteString('');
        let stateRoots = toByteString('');
        for (let i = 0; i < STATE_OUTPUT_COUNT_MAX; i++) {
            if (i < outputCount) {
                const ownerAddrOrScript = ownerAddrOrScripts[i];
                assert(len(ownerAddrOrScript) > 0n);
                const tokenScriptIndex = tokenScriptIndexes[i];
                assert(tokenScriptIndex < inputTokenTypes);
                if (tokenScriptIndex != -1n) {
                    // this is a token output
                    const tokenAmount = outputTokens[i];
                    assert(tokenAmount > 0n);
                    sumOutputTokens[Number(tokenScriptIndex)] = SafeMath.add(
                        sumOutputTokens[Number(tokenScriptIndex)],
                        tokenAmount,
                    );
                    const tokenStateHash = CAT20Proto.stateHash({
                        ownerAddr: ownerAddrOrScript,
                        amount: tokenAmount,
                    });
                    assert(nextStateHashes[i] == tokenStateHash);
                    const tokenScript = curState.tokenScripts[Number(tokenScriptIndex)];
                    outputs += TxUtils.buildOutput(tokenScript, outputSatoshis[i]);
                } else {
                    // this is a non-token output
                    assert(outputTokens[i] == 0n);
                    // locking script of this non-token output cannot be the same as any token script in curState
                    for (let j = 0; j < GUARD_TOKEN_TYPE_MAX; j++) {
                        assert(ownerAddrOrScript != curState.tokenScripts[j]);
                    }
                    outputs += TxUtils.buildOutput(ownerAddrOrScript, outputSatoshis[i]);
                }
            } else {
                assert(len(ownerAddrOrScripts[i]) == 0n);
                assert(tokenScriptIndexes[i] == -1n);
                assert(outputTokens[i] == 0n);
                assert(nextStateHashes[i] == toByteString(''));
                assert(outputSatoshis[i] == toByteString(''));
            }
            stateRoots += hash160(nextStateHashes[i]);
        }

        // check token amount consistency of inputs and outputs
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            assert(sumInputTokens[i] == curState.tokenAmounts[i]);
            assert(sumInputTokens[i] == SafeMath.add(sumOutputTokens[i], curState.tokenBurnAmounts[i]));
            if (i < Number(inputTokenTypes)) {
                assert(sumInputTokens[i] > 0n);
            } else {
                assert(sumInputTokens[i] == 0n);
                assert(sumOutputTokens[i] == 0n);
                // no need to check below two lines here, but we keep them here for better readability
                assert(curState.tokenAmounts[i] == 0n);
                assert(curState.tokenBurnAmounts[i] == 0n);
            }
        }

        // confine curTx outputs
        const hashRootOutput = TxUtils.buildStateHashRootOutput(hash160(stateRoots));
        assert(sha256(hashRootOutput + outputs) == shPreimage.shaOutputs, 'shaOutputs mismatch');
    }
}
