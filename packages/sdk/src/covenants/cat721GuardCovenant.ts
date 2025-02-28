import { ByteString, fill, FixedArray, int2ByteString } from 'scrypt-ts';
import { NftGuardProto } from '../contracts/nft/nftGuardProto';
import { NftGuard } from '../contracts/nft/nftGuard';
import { Covenant } from '../lib/covenant';
import { CatPsbt, InputContext, SubContractCall } from '../lib/catPsbt';
import { getTxHeaderCheck } from '../lib/proof';
import { SupportedNetwork } from '../lib/constants';
import { btc } from '../lib/btc';
import { CAT721Covenant } from './cat721Covenant';
import { CAT721State, NftGuardConstState, NftGuardInfo } from '../contracts/nft/types';
import { STATE_OUTPUT_COUNT_MAX, TX_INPUT_COUNT_MAX } from '../contracts/constants';
import { InputStateProof, StateHashes } from '../contracts/types';

export class CAT721GuardCovenant extends Covenant<NftGuardConstState> {
    // locked artifacts md5
    static readonly LOCKED_ASM_VERSION = '728de8cfa1233aca7e9c321f02889867';

    constructor(state?: NftGuardConstState, network?: SupportedNetwork) {
        super(
            [
                {
                    contract: new NftGuard(),
                },
            ],
            {
                lockedAsmVersion: CAT721GuardCovenant.LOCKED_ASM_VERSION,
                network,
            },
        );

        this.state = state;
    }

    serializedState(): ByteString {
        return NftGuardProto.propHashes(this.state);
    }

    transfer(
        inputIndex: number,
        inputCtxs: Map<number, InputContext>,
        nftOutputs: (CAT721Covenant | undefined)[],
        inputStateProofArray: FixedArray<InputStateProof, typeof TX_INPUT_COUNT_MAX>,
        cat721StateArray: FixedArray<CAT721State, typeof TX_INPUT_COUNT_MAX>,
    ): SubContractCall {
        const inputCtx = inputCtxs.get(inputIndex);
        if (!inputCtx) {
            throw new Error('Input context is not available');
        }

        const preState = this.state;
        if (!preState) {
            throw new Error('Nft state is not available');
        }

        if (nftOutputs.length !== STATE_OUTPUT_COUNT_MAX) {
            throw new Error(
                `Invalid nft owner output length: ${nftOutputs.length}, should be ${STATE_OUTPUT_COUNT_MAX}`,
            );
        }

        const nftOwners = nftOutputs.map((output) => output?.state!.ownerAddr);
        const localIdList = nftOutputs.map((output) => (output ? output.state!.localId : -1n));
        const collectionScriptIndexArray = fill(-1n, STATE_OUTPUT_COUNT_MAX);
        nftOutputs.forEach((value, index) => {
            if (value) {
                collectionScriptIndexArray[index] = 0n;
            }
        });

        return {
            method: 'unlock',
            argsBuilder: (curPsbt: CatPsbt) => {
                const { shPreimage, prevoutsCtx, spentScriptsCtx } = inputCtx;
                const args = [];
                args.push(curPsbt.txState.stateHashList); // curTxoStateHashes
                args.push(curPsbt.txOutputs.length - 1); // the number of outputs except for the state hash root output
                args.push(
                    nftOwners.map((ownerAddr, oidx) => {
                        const output = curPsbt.txOutputs[oidx + 1];
                        return ownerAddr || (output ? Buffer.from(output.script).toString('hex') : '');
                    }),
                ); // ownerAddrOrScriptList
                args.push(localIdList); // localIdList
                args.push(collectionScriptIndexArray); // collectionScriptIndexArray
                args.push(curPsbt.getOutputSatoshisList()); // outputSatoshisList
                args.push(inputStateProofArray); // inputStateProofArray
                args.push(cat721StateArray); // cat721StateArray
                args.push(preState); // preState
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
    ): NftGuardInfo {
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
