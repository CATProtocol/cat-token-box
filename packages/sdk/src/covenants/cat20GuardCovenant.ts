import { ByteString, FixedArray, fill, int2ByteString } from 'scrypt-ts';
import { GuardProto } from '../contracts/token/guardProto';
import { Guard } from '../contracts/token/guard';
import { Covenant } from '../lib/covenant';
import { CatPsbt, InputContext, SubContractCall } from '../lib/catPsbt';
import { getTxHeaderCheck } from '../lib/proof';
import { SupportedNetwork } from '../lib/constants';
import { btc } from '../lib/btc';
import { CAT20Covenant } from './cat20Covenant';
import { CAT20State, GuardConstState, GuardInfo } from '../contracts/token/types';
import { InputStateProof, StateHashes } from '../contracts/types';
import { TX_INPUT_COUNT_MAX, STATE_OUTPUT_COUNT_MAX } from '../contracts/constants';

export class Cat20GuardCovenant extends Covenant<GuardConstState> {
    // locked artifacts md5
    static readonly LOCKED_ASM_VERSION = '84f55b8ad02d04f55f79ab8a506211fc';

    constructor(state?: GuardConstState, network?: SupportedNetwork) {
        super(
            [
                {
                    contract: new Guard(),
                },
            ],
            {
                lockedAsmVersion: Cat20GuardCovenant.LOCKED_ASM_VERSION,
                network,
            },
        );

        this.state = state;
    }

    serializedState(): ByteString {
        return GuardProto.propHashes(this.state);
    }

    transfer(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        tokenOutputs: (CAT20Covenant | undefined)[],
        inputStateProofArray: FixedArray<InputStateProof, typeof TX_INPUT_COUNT_MAX>,
        cat20StateArray: FixedArray<CAT20State, typeof TX_INPUT_COUNT_MAX>,
    ): SubContractCall {
        const inputCtx = inputCtxs.get(inputIndex);
        if (!inputCtx) {
            throw new Error('Input context is not available');
        }

        const preState = this.state;
        if (!preState) {
            throw new Error('Token state is not available');
        }

        if (tokenOutputs.length !== STATE_OUTPUT_COUNT_MAX) {
            throw new Error(
                `Invalid token owner output length: ${tokenOutputs.length}, should be ${STATE_OUTPUT_COUNT_MAX}`,
            );
        }

        const tokenOwners = tokenOutputs.map((output) => output?.state!.ownerAddr);
        const tokenAmounts = tokenOutputs.map((output) => output?.state!.amount || 0n);

        const tokenScriptIndexArray = fill(-1n, STATE_OUTPUT_COUNT_MAX);
        tokenOutputs.forEach((value, index) => {
            if (value) {
                tokenScriptIndexArray[index] = 0n;
            }
        });

        return {
            method: 'unlock',
            argsBuilder: (curPsbt: CatPsbt) => {
                const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx;

                const args = [];
                args.push(curPsbt.txState.stateHashList); // curTxoStateHashes
                args.push(
                    tokenOwners.map((ownerAddr, oidx) => {
                        const output = curPsbt.txOutputs[oidx + 1];
                        return ownerAddr || (output ? Buffer.from(output.script).toString('hex') : '');
                    }),
                ); // ownerAddrOrScriptList
                args.push(tokenAmounts); // tokenAmountList
                args.push(tokenScriptIndexArray); // tokenOutputMaskList
                args.push(curPsbt.getOutputSatoshisList()); // outputSatoshisList
                // args.push(tokenSatoshis); // tokenSatoshis
                args.push(inputStateProofArray); // inputStateProofArray
                args.push(cat20StateArray); // cat20StateArray
                args.push(preState); // preState
                args.push(curPsbt.txOutputs.length - 1); // the number of outputs except for the state hash root output
                args.push(shPreimage); // shPreimage
                args.push(prevoutsCtx); // prevoutsCtx
                args.push(spentScriptsCtx); // spentScriptsCtx
                return args;
            },
        };
    }

    getGuardInfo(
        inputIndex: number,
        guardTxHex: string,
        txStatesInfo: StateHashes,
        guardTxOutputIndex?: number,
    ): GuardInfo {
        guardTxOutputIndex ||= 1;
        const { tx } = getTxHeaderCheck(new btc.Transaction(guardTxHex), guardTxOutputIndex);
        return {
            prevTxPreimage: tx,
            inputIndexVal: BigInt(inputIndex),
            prevOutputIndex: int2ByteString(BigInt(guardTxOutputIndex), 4n),
            prevOutputIndexVal: BigInt(guardTxOutputIndex),
            curState: this.state,
            curStateHashes: txStatesInfo,
        };
    }
}
