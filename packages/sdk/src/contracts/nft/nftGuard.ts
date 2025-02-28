import {
    ByteString,
    FixedArray,
    SmartContract,
    assert,
    fill,
    hash160,
    int2ByteString,
    len,
    method,
    sha256,
    toByteString,
} from 'scrypt-ts';
import { CAT721Proto } from './cat721Proto';
import { InputStateProof, int32, PrevoutsCtx, SHPreimage, SpentScriptsCtx, StateHashes } from '../types';
import {
    STATE_OUTPUT_COUNT_MAX,
    NFT_GUARD_COLLECTION_TYPE_MAX,
    TX_INPUT_COUNT_MAX,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
} from '../constants';
import { CAT721State, NftGuardConstState } from './types';
import { ContextUtils } from '../utils/contextUtils';
import { NftGuardProto } from './nftGuardProto';
import { TxUtils } from '../utils/txUtils';
import { StateUtils } from '../utils/stateUtils';

export class NftGuard extends SmartContract {
    @method()
    public unlock(
        nextStateHashes: StateHashes,
        // the number of curTx outputs except for the state hash root output
        outputCount: int32,

        // the logic is the same as token guard
        ownerAddrOrScripts: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
        // localId list of curTx nft outputs
        // note that the element index of this array does NOT correspond to the outputIndex of curTx nft output
        // and the order of nft outputs MUST be the same as the order of nft inputs excluding the burned ones
        // e.g.
        // curState.nftScripts        ['nftA', 'nftB', 'fd', 'fc']
        // curState.nftScriptIndexes  [0, 0, 1, -1, -1, -1]
        // -> input nfts in curTx     [nftA_20, nftA_21, nftB_10, /, /, /]
        // curState.burnMasks         [false, true, false, false, false, false]
        // output nftScriptIndexes    [-1, 0, 1, -1, -1]
        // -> output nfts in curTx    [/, nftA_20, nftB_10, /, /]
        // -> outputLocalIds
        //        correct             [20, 10, -1, -1, -1]
        //        invalid             [-1, 20, 10, -1, -1]
        outputLocalIds: FixedArray<int32, typeof STATE_OUTPUT_COUNT_MAX>,
        nftScriptIndexes: FixedArray<int32, typeof STATE_OUTPUT_COUNT_MAX>,
        outputSatoshis: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
        inputStateProofs: FixedArray<InputStateProof, typeof TX_INPUT_COUNT_MAX>,
        cat721States: FixedArray<CAT721State, typeof TX_INPUT_COUNT_MAX>,

        // guard state of current spending UTXO
        curState: NftGuardConstState,
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

        const curStateHash = NftGuardProto.stateHash(curState);
        const curInputIndexVal = prevoutsCtx.inputIndexVal;
        // inputStateHashes in guard state cannot contain the guard state hash itself
        assert(curState.inputStateHashes[Number(prevoutsCtx.inputIndexVal)] == toByteString(''));
        // check input state proof for each curTx input
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const inputStateHash = BigInt(i) == curInputIndexVal ? curStateHash : curState.inputStateHashes[i];
            if (i < inputCount) {
                StateUtils.checkInputState(inputStateProofs[i], inputStateHash, prevoutsCtx.prevouts[i]);
            } else {
                // ensure the placeholders are empty
                assert(curState.inputStateHashes[i] == toByteString(''));
                assert(curState.nftScriptIndexes[i] == -1n);
            }
        }

        // how many different types of nft in curTx inputs
        let inputNftTypes = 0n;
        const nftScriptPlaceholders: FixedArray<ByteString, typeof NFT_GUARD_COLLECTION_TYPE_MAX> = [
            toByteString('ff'),
            toByteString('fe'),
            toByteString('fd'),
            toByteString('fc'),
        ];
        for (let i = 0; i < NFT_GUARD_COLLECTION_TYPE_MAX; i++) {
            if (curState.nftScripts[i] != nftScriptPlaceholders[i]) {
                inputNftTypes++;
            }
        }
        // ensure there are no placeholders between valid nft scripts in curState.nftScripts
        for (let i = 0; i < NFT_GUARD_COLLECTION_TYPE_MAX; i++) {
            if (i < Number(inputNftTypes)) {
                assert(curState.nftScripts[i] != nftScriptPlaceholders[i]);
                assert(len(curState.nftScripts[i]) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
            } else {
                assert(curState.nftScripts[i] == nftScriptPlaceholders[i]);
            }
        }
        assert(inputNftTypes > 0n);

        // go through input nfts
        let nftScriptIndexMax = -1n;
        // nextNfts are all the input nfts except the burned ones
        const nextNfts: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX> = fill(
            toByteString(''),
            STATE_OUTPUT_COUNT_MAX,
        );
        let nextNftCount = 0n;
        for (let i = 0; i < TX_INPUT_COUNT_MAX; i++) {
            const nftScriptIndex = curState.nftScriptIndexes[Number(i)];
            assert(nftScriptIndex < inputNftTypes);
            if (nftScriptIndex != -1n) {
                // this is an nft input
                const nftScript = curState.nftScripts[Number(nftScriptIndex)];
                assert(nftScript == spentScriptsCtx[i]);
                assert(curState.inputStateHashes[i] == CAT721Proto.stateHash(cat721States[i]));
                nftScriptIndexMax = nftScriptIndex > nftScriptIndexMax ? nftScriptIndex : nftScriptIndexMax;
                if (!curState.nftBurnMasks[i]) {
                    // this nft is not burned
                    nextNfts[Number(nextNftCount)] = nftScript + hash160(int2ByteString(cat721States[i].localId));
                    nextNftCount++;
                }
            } else {
                // this is a non-nft input
                assert(!curState.nftBurnMasks[i]);
            }
        }
        assert(nftScriptIndexMax >= 0n && nftScriptIndexMax == inputNftTypes - 1n);

        // build curTx outputs and stateRoots
        assert(outputCount >= 0n && outputCount <= STATE_OUTPUT_COUNT_MAX);
        let outputNftCount = 0n;
        let outputs = toByteString('');
        let stateRoots = toByteString('');
        for (let i = 0; i < STATE_OUTPUT_COUNT_MAX; i++) {
            if (i < outputCount) {
                const ownerAddrOrScript = ownerAddrOrScripts[i];
                assert(len(ownerAddrOrScript) > 0n);
                const nftScriptIndex = nftScriptIndexes[i];
                assert(nftScriptIndex < inputNftTypes);
                if (nftScriptIndex != -1n) {
                    // this is an nft output
                    const nftScript = curState.nftScripts[Number(nftScriptIndex)];
                    const localId = outputLocalIds[Number(outputNftCount)];
                    assert(localId >= 0n);
                    assert(nextNfts[Number(outputNftCount)] == nftScript + hash160(int2ByteString(localId)));
                    outputNftCount++;
                    const nftStateHash = CAT721Proto.stateHash({
                        ownerAddr: ownerAddrOrScript,
                        localId,
                    });
                    assert(nextStateHashes[i] == nftStateHash);
                    outputs += TxUtils.buildOutput(nftScript, outputSatoshis[i]);
                } else {
                    // this is a non-nft output
                    // locking script of this non-nft output cannot be the same as any nft script in curState
                    for (let j = 0; j < NFT_GUARD_COLLECTION_TYPE_MAX; j++) {
                        assert(ownerAddrOrScript != curState.nftScripts[j]);
                    }
                    outputs += TxUtils.buildOutput(ownerAddrOrScript, outputSatoshis[i]);
                }
            } else {
                assert(len(ownerAddrOrScripts[i]) == 0n);
                assert(nftScriptIndexes[i] == -1n);
                assert(outputLocalIds[i] == -1n);
                assert(nextStateHashes[i] == toByteString(''));
                assert(outputSatoshis[i] == toByteString(''));
            }
            stateRoots += hash160(nextStateHashes[i]);
        }
        // ensure outputLocalIds is default value when there are no more output nfts
        for (let i = 0; i < STATE_OUTPUT_COUNT_MAX; i++) {
            if (i >= outputNftCount) {
                assert(outputLocalIds[i] == -1n);
            }
        }

        // check nft consistency of inputs and outputs
        assert(nextNftCount == outputNftCount);

        // confine curTx outputs
        const hashRootOutput = TxUtils.buildStateHashRootOutput(hash160(stateRoots));
        assert(sha256(hashRootOutput + outputs) == shPreimage.shaOutputs, 'shaOutputs mismatch');
    }
}
