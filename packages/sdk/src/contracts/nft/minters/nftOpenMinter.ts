import { method, SmartContract, assert, prop, ByteString, PubKey, Sig, toByteString, hash160, sha256 } from 'scrypt-ts';
import { BacktraceInfo, TxOut, int32, PrevoutsCtx, SHPreimage, SpentScriptsCtx, StateHashes } from '../../types';
import { CAT721State, MerkleProof, ProofNodePos, NftOpenMinterState } from '../types';
import { ContextUtils } from '../../utils/contextUtils';
import { StateUtils } from '../../utils/stateUtils';
import { NftOpenMinterProto } from './nftOpenMinterProto';
import { NftOpenMinterMerkleTree } from './nftOpenMinterMerkleTree';
import { Backtrace } from '../../utils/backtrace';
import { CAT721Proto } from '../cat721Proto';
import { TxUtils } from '../../utils/txUtils';
import { OwnerUtils } from '../../utils/ownerUtils';

export class NftOpenMinter extends SmartContract {
    @prop()
    genesisOutpoint: ByteString;

    @prop()
    max: int32;

    @prop()
    premine: int32;

    @prop()
    preminerAddr: ByteString;

    constructor(genesisOutpoint: ByteString, maxCount: int32, premine: int32, premineAddr: ByteString) {
        super(...arguments);
        this.genesisOutpoint = genesisOutpoint;
        this.max = maxCount;
        this.premine = premine;
        this.preminerAddr = premineAddr;
    }

    @method()
    public mint(
        nextStateHashes: StateHashes,
        // args to mint nft
        nftMint: CAT721State,
        proof: MerkleProof,
        proofNodePos: ProofNodePos,
        // premine related args
        preminerPubKeyPrefix: ByteString,
        preminerPubKey: PubKey,
        preminerSig: Sig,
        // output satoshis of curTx minter output
        minterSatoshis: ByteString,
        // output satoshis of curTx nft output
        nftSatoshis: ByteString,
        // state of current spending UTXO, comes from prevTx
        curState: NftOpenMinterState,
        preTxstateHashes: StateHashes,
        // backtrace
        backtraceInfo: BacktraceInfo,
        // curTx context
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScriptsCtx: SpentScriptsCtx,
        // curTx change output
        changeInfo: TxOut,
    ) {
        // ctx
        // check sighash preimage
        assert(this.checkSig(ContextUtils.checkSHPreimage(shPreimage), ContextUtils.Gx), 'preimage check error');
        // check prevouts
        const inputCount = ContextUtils.checkPrevoutsCtx(prevoutsCtx, shPreimage.shaPrevouts, shPreimage.inputIndex);
        // check spent scripts
        ContextUtils.checkSpentScriptsCtx(spentScriptsCtx, shPreimage.shaSpentScripts, inputCount);

        // back to genesis
        const minterScript = spentScriptsCtx[Number(prevoutsCtx.inputIndexVal)];
        Backtrace.verifyUnique(backtraceInfo, prevoutsCtx.prevTxHash, this.genesisOutpoint, minterScript);

        // check state of prevTx
        StateUtils.checkStateHash(
            preTxstateHashes,
            NftOpenMinterProto.stateHash(curState),
            backtraceInfo.prevTxPreimage.hashRoot,
            prevoutsCtx.prevOutputIndexVal,
        );
        assert(curState.nextLocalId < this.max);

        // minter input should be the first input in curTx
        assert(prevoutsCtx.inputIndexVal == 0n);

        const commitScript = spentScriptsCtx[1];
        const merkleRoot = NftOpenMinterMerkleTree.updateLeaf(
            NftOpenMinterProto.leafStateHash({
                commitScript: commitScript,
                localId: curState.nextLocalId,
                isMined: false,
            }),
            NftOpenMinterProto.leafStateHash({
                commitScript: commitScript,
                localId: curState.nextLocalId,
                isMined: true,
            }),
            proof,
            proofNodePos,
            curState.merkleRoot,
        );

        // build curTx outputs
        let leadingStateRoots = toByteString('');
        let stateCount = 0n;
        // next minter output
        let minterOutput = toByteString('');
        const nextLocalId = curState.nextLocalId + 1n;
        if (nextLocalId < this.max) {
            minterOutput += TxUtils.buildOutput(minterScript, minterSatoshis);
            leadingStateRoots += hash160(
                NftOpenMinterProto.stateHash({
                    nftScript: curState.nftScript,
                    merkleRoot,
                    nextLocalId,
                }),
            );
            stateCount++;
        }
        // next nft output
        const nftOutput = TxUtils.buildOutput(curState.nftScript, nftSatoshis);
        assert(nftMint.localId == curState.nextLocalId);
        leadingStateRoots += hash160(CAT721Proto.stateHash(nftMint));
        stateCount++;
        if (nftMint.localId < this.premine) {
            // preminer checksig
            OwnerUtils.checkUserOwner(preminerPubKeyPrefix, preminerPubKey, this.preminerAddr);
            assert(this.checkSig(preminerSig, preminerPubKey));
        }
        // state hash root output
        const hashRootOutput = StateUtils.buildStateHashRootOutput(leadingStateRoots, stateCount, nextStateHashes);
        // change output
        const changeOutput = TxUtils.buildChangeOutput(changeInfo);

        // confine curTx outputs
        const shaOutputs = sha256(hashRootOutput + minterOutput + nftOutput + changeOutput);
        assert(shaOutputs == shPreimage.shaOutputs, 'shaOutputs mismatch');
    }
}
