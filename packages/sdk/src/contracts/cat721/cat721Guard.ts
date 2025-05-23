import {
    assert,
    ByteString,
    fill,
    FixedArray,
    hash160,
    Int32,
    len,
    method,
    NFT_GUARD_COLLECTION_TYPE_MAX,
    SmartContract,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
    TxUtils,
    int32ToByteString,
    Ripemd160,
} from '@scrypt-inc/scrypt-ts-btc';
import { CAT721GuardConstState, CAT721State } from './types.js';
import { CAT721StateLib } from './cat721State.js';
import { CAT721GuardStateLib } from './cat721GuardState.js';

export class CAT721Guard extends SmartContract<CAT721GuardConstState> {
    @method({ autoCheckInputStateHash: false })
    public unlock(
        // the logic is the same as cat20 guard
        ownerAddrOrScripts: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
        // localId list of curTx nft outputs
        // note that the element index of this array does NOT correspond to the outputIndex of curTx nft output
        // and the order of nft outputs MUST be the same as the order of nft inputs excluding the burned ones
        // e.g.
        // this.state.nftScripts        ['nftA', 'nftB', 'fd', 'fc']
        // this.state.nftScriptIndexes  [0, 0, 1, -1, -1, -1]
        // -> input nfts in curTx     [nftA_20, nftA_21, nftB_10, /, /, /]
        // this.state.burnMasks         [false, true, false, false, false, false]
        // output nftScriptIndexes    [-1, 0, 1, -1, -1]
        // -> output nfts in curTx    [/, nftA_20, nftB_10, /, /]
        // -> outputLocalIds
        //        correct             [20, 10, -1, -1, -1]
        //        invalid             [-1, 20, 10, -1, -1]
        outputLocalIds: FixedArray<Int32, typeof STATE_OUTPUT_COUNT_MAX>,
        nftScriptIndexes: FixedArray<Int32, typeof STATE_OUTPUT_COUNT_MAX>,
        outputSatoshis: FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>,
        cat721States: FixedArray<CAT721State, typeof TX_INPUT_COUNT_MAX>,

        // the number of curTx outputs except for the state hash root output
        outputCount: Int32,
    ) {
        // inputStateHashes in guard state cannot contain the guard state hash itself
        assert(this.state.inputStateHashes[Number(this.ctx.inputIndexVal)] == toByteString(''));

        // check state
        const thisStateHash = CAT721GuardStateLib.formalCheckState(this.state);

        // how many different types of nft in curTx inputs
        let inputNftTypes = 0n;
        const nftScriptPlaceholders: FixedArray<ByteString, typeof NFT_GUARD_COLLECTION_TYPE_MAX> = [
            toByteString('ff'),
            toByteString('fe'),
            toByteString('fd'),
            toByteString('fc'),
        ];
        for (let i = 0; i < NFT_GUARD_COLLECTION_TYPE_MAX; i++) {
            if (this.state.nftScripts[i] != nftScriptPlaceholders[i]) {
                inputNftTypes++;
            }
        }
        // ensure there are no placeholders between valid nft scripts in this.state.nftScripts
        for (let i = 0; i < NFT_GUARD_COLLECTION_TYPE_MAX; i++) {
            if (i < Number(inputNftTypes)) {
                assert(this.state.nftScripts[i] != nftScriptPlaceholders[i]);
                assert(len(this.state.nftScripts[i]) == TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN);
            } else {
                assert(this.state.nftScripts[i] == nftScriptPlaceholders[i]);
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
        for (let i = 0n; i < TX_INPUT_COUNT_MAX; i++) {
            const nftScriptIndex = this.state.nftScriptIndexes[Number(i)];
            assert(nftScriptIndex < inputNftTypes);
            if (nftScriptIndex != -1n) {
                // this is an nft input
                const nftScript = this.state.nftScripts[Number(nftScriptIndex)];
                assert(nftScript == this.ctx.spentScripts[Number(i)]);
                const cat721StateHash = CAT721StateLib.stateHash(cat721States[Number(i)]);
                assert(this.state.inputStateHashes[Number(i)] == cat721StateHash);
                // this.checkInputStateHash(i, cat721StateHash);
                nftScriptIndexMax = nftScriptIndex > nftScriptIndexMax ? nftScriptIndex : nftScriptIndexMax;
                if (!this.state.nftBurnMasks[Number(i)]) {
                    // this nft is not burned
                    // todo
                    nextNfts[Number(nextNftCount)] =
                        nftScript + hash160(int32ToByteString(cat721States[Number(i)].localId));
                    nextNftCount++;
                }
            } else {
                // this is a non-nft input
                assert(!this.state.nftBurnMasks[Number(i)]);
            }
            if (nftScriptIndex != -1n || i == this.ctx.inputIndexVal) {
                this.checkInputStateHash(
                    i,
                    i !== this.ctx.inputIndexVal ? this.state.inputStateHashes[Number(i)] : thisStateHash,
                );
            }
        }
        assert(nftScriptIndexMax >= 0n && nftScriptIndexMax == inputNftTypes - 1n);

        // build curTx outputs and stateRoots
        assert(outputCount >= 0n && outputCount <= STATE_OUTPUT_COUNT_MAX);
        let outputNftCount = 0n;
        for (let i = 0; i < STATE_OUTPUT_COUNT_MAX; i++) {
            if (i < outputCount) {
                const ownerAddrOrScript = ownerAddrOrScripts[i];
                assert(len(ownerAddrOrScript) > 0n);
                const nftScriptIndex = nftScriptIndexes[i];
                assert(nftScriptIndex < inputNftTypes);
                if (nftScriptIndex != -1n) {
                    // this is an nft output
                    const nftScript = this.state.nftScripts[Number(nftScriptIndex)];
                    const localId = outputLocalIds[Number(outputNftCount)];
                    assert(localId >= 0n);
                    assert(nextNfts[Number(outputNftCount)] == nftScript + hash160(int32ToByteString(localId)));
                    outputNftCount++;
                    const nftStateHash = CAT721StateLib.stateHash({
                        ownerAddr: ownerAddrOrScript,
                        localId,
                    });
                    assert(this.ctx.nextStateHashes[i] == nftStateHash);
                    this.appendStateOutput(
                        TxUtils.buildOutput(this.state.nftScripts[Number(nftScriptIndex)], outputSatoshis[i]),
                        Ripemd160(nftStateHash),
                    );
                } else {
                    // this is a non-nft output
                    // locking script of this non-nft output cannot be the same as any nft script in this.state
                    for (let j = 0; j < NFT_GUARD_COLLECTION_TYPE_MAX; j++) {
                        assert(ownerAddrOrScript != this.state.nftScripts[j]);
                    }
                    this.appendStateOutput(
                        TxUtils.buildOutput(ownerAddrOrScript, outputSatoshis[i]),
                        this.ctx.nextStateHashes[i] as Ripemd160,
                    );
                }
            } else {
                assert(len(ownerAddrOrScripts[i]) == 0n);
                assert(nftScriptIndexes[i] == -1n);
                assert(outputLocalIds[i] == -1n);
                assert(this.ctx.nextStateHashes[i] == toByteString(''));
                assert(outputSatoshis[i] == toByteString(''));
            }
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
        const outputs = this.buildStateOutputs();
        assert(this.checkOutputs(outputs), 'Outputs mismatch with the transaction context');
    }

    static createEmptyState(): CAT721GuardConstState {
        const nftScripts = fill(toByteString(''), NFT_GUARD_COLLECTION_TYPE_MAX);
        // default value to ensure the uniqueness of nft scripts
        nftScripts[0] = 'ff';
        nftScripts[1] = 'fe';
        nftScripts[2] = 'fd';
        nftScripts[3] = 'fc';
        return {
            nftScripts: nftScripts,
            nftBurnMasks: fill(false, TX_INPUT_COUNT_MAX),
            inputStateHashes: fill(toByteString(''), TX_INPUT_COUNT_MAX),
            nftScriptIndexes: fill(-1n, TX_INPUT_COUNT_MAX),
        };
    }
}
