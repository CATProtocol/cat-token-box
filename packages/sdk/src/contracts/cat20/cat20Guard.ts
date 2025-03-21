import {
    assert,
    ByteString,
    fill,
    FixedArray,
    GUARD_TOKEN_TYPE_MAX,
    Int32,
    len,
    method,
    Ripemd160,
    SmartContract,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
    TxUtils,
} from '@scrypt-inc/scrypt-ts-btc';
import { CAT20GuardConstState, CAT20State } from './types';
import { SafeMath } from '../utils/safeMath';
import { CAT20StateLib } from './cat20State';
import { CAT20GuardStateLib } from './cat20GuardState';

export class CAT20Guard extends SmartContract<CAT20GuardConstState> {
    @method()
    public unlock(
        // for each curTx output except the state hash root output,
        // if it is a token output, the value is token owner address of this output,
        // otherwise, the value is the locking script of this output
        ownerAddrOrScripts: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
        // for each curTx output except the state hash root output,
        // if it is a token output, the value is the token amount of this output,
        // otherwise, the value is 0 by default
        outputTokens: FixedArray<Int32, typeof STATE_OUTPUT_COUNT_MAX>,
        // for each curTx output except the state hash root output,
        // if it is a token output,
        // the value marks the index of the token script used by this output in the tokenScripts,
        // otherwise, the value is -1 by default
        // this logic is the same as tokenScriptIndexes in GuardConstState which is used for token inputs
        tokenScriptIndexes: FixedArray<Int32, typeof STATE_OUTPUT_COUNT_MAX>,
        // output satoshi of each curTx output except the state hash root output
        outputSatoshis: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
        // for each curTx input,
        // if it is a token input, the value is the raw state of this input,
        // otherwise, the value is an empty state by default
        cat20States: FixedArray<CAT20State, typeof TX_INPUT_COUNT_MAX>,
        // the number of curTx outputs except for the state hash root output
        outputCount: Int32,
    ) {
        // inputStateHashes in guard state cannot contain the guard state hash itself
        assert(this.state.inputStateHashes[Number(this.ctx.inputIndexVal)] == toByteString(''));

        // check state
        CAT20GuardStateLib.checkState(this.state);

        // how many different types of tokens in curTx inputs
        let inputTokenTypes = 0n;
        const tokenScriptPlaceholders: FixedArray<ByteString, typeof GUARD_TOKEN_TYPE_MAX> = [
            toByteString('ff'),
            toByteString('fe'),
            toByteString('fd'),
            toByteString('fc'),
        ];
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            if (this.state.tokenScripts[i] != tokenScriptPlaceholders[i]) {
                inputTokenTypes++;
            }
        }
        // ensure there are no placeholders between valid token scripts in curState.tokenScripts
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            if (i < Number(inputTokenTypes)) {
                assert(this.state.tokenScripts[i] != tokenScriptPlaceholders[i]);
                assert(len(this.state.tokenScripts[i]) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
            } else {
                assert(this.state.tokenScripts[i] == tokenScriptPlaceholders[i]);
            }
        }
        assert(inputTokenTypes > 0n);

        // inputTokenTypes here is not trustable yet
        // user could append token scripts in curState.tokenScripts that are not used in curTx inputs

        // sum token input amount, data comes from cat20 raw states passed in by the user
        const sumInputTokens = fill(0n, GUARD_TOKEN_TYPE_MAX);
        let tokenScriptIndexMax = -1n;
        for (let i = 0n; i < TX_INPUT_COUNT_MAX; i++) {
            const tokenScriptIndex = this.state.tokenScriptIndexes[Number(i)];
            assert(tokenScriptIndex < inputTokenTypes);
            if (tokenScriptIndex != -1n) {
                // this is a token input
                const tokenScript = this.state.tokenScripts[Number(tokenScriptIndex)];
                assert(tokenScript == this.ctx.spentScripts[Number(i)]);
                CAT20StateLib.checkState(cat20States[Number(i)]);
                const cat20StateHash = CAT20StateLib.stateHash(cat20States[Number(i)]);
                assert(this.state.inputStateHashes[Number(i)] == cat20StateHash);
                this.checkInputStateHash(i, cat20StateHash);
                sumInputTokens[Number(tokenScriptIndex)] = SafeMath.add(
                    sumInputTokens[Number(tokenScriptIndex)],
                    cat20States[Number(i)].amount,
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
                    const tokenStateHash = CAT20StateLib.stateHash({
                        ownerAddr: ownerAddrOrScript,
                        amount: tokenAmount,
                    });
                    assert(this.ctx.nextStateHashes[i] == tokenStateHash);
                    this.appendStateOutput(
                        TxUtils.buildOutput(this.state.tokenScripts[Number(tokenScriptIndex)], outputSatoshis[i]),
                        Ripemd160(tokenStateHash),
                    );
                } else {
                    // this is a non-token output
                    assert(outputTokens[i] == 0n);
                    // locking script of this non-token output cannot be the same as any token script in curState
                    for (let j = 0; j < GUARD_TOKEN_TYPE_MAX; j++) {
                        assert(ownerAddrOrScript != this.state.tokenScripts[j]);
                    }
                    this.appendStateOutput(
                        TxUtils.buildOutput(ownerAddrOrScript, outputSatoshis[i]),
                        this.ctx.nextStateHashes[i] as Ripemd160,
                    );
                }
            } else {
                assert(len(ownerAddrOrScripts[i]) == 0n);
                assert(tokenScriptIndexes[i] == -1n);
                assert(outputTokens[i] == 0n);
                assert(this.ctx.nextStateHashes[i] == toByteString(''));
                assert(outputSatoshis[i] == toByteString(''));
            }
        }

        // check token amount consistency of inputs and outputs
        for (let i = 0; i < GUARD_TOKEN_TYPE_MAX; i++) {
            assert(sumInputTokens[i] == this.state.tokenAmounts[i]);
            assert(sumInputTokens[i] == SafeMath.add(sumOutputTokens[i], this.state.tokenBurnAmounts[i]));
            if (i < Number(inputTokenTypes)) {
                assert(sumInputTokens[i] > 0n);
            } else {
                assert(sumInputTokens[i] == 0n);
                assert(sumOutputTokens[i] == 0n);
                // no need to check below two lines here, but we keep them here for better readability
                assert(this.state.tokenAmounts[i] == 0n);
                assert(this.state.tokenBurnAmounts[i] == 0n);
            }
        }

        // confine curTx outputs
        const outputs = this.buildStateOutputs();
        assert(this.checkOutputs(outputs), 'Outputs mismatch with the transaction context');
    }

    static createEmptyState(): CAT20GuardConstState {
        const tokenScripts = fill(toByteString(''), GUARD_TOKEN_TYPE_MAX);
        // default value to ensure the uniqueness of token scripts
        tokenScripts[0] = 'ff';
        tokenScripts[1] = 'fe';
        tokenScripts[2] = 'fd';
        tokenScripts[3] = 'fc';
        return {
            tokenScripts: tokenScripts,
            tokenAmounts: fill(0n, GUARD_TOKEN_TYPE_MAX),
            tokenBurnAmounts: fill(0n, GUARD_TOKEN_TYPE_MAX),
            inputStateHashes: fill(toByteString(''), TX_INPUT_COUNT_MAX),
            tokenScriptIndexes: fill(-1n, TX_INPUT_COUNT_MAX),
        };
    }
}
