import { method, SmartContract, assert, prop, ByteString, sha256, PubKey, Sig, hash160, toByteString } from 'scrypt-ts';
import { BacktraceInfo, TxOut, int32, PrevoutsCtx, SHPreimage, SpentScriptsCtx, StateHashes } from '../../types';
import { CAT721State, NftClosedMinterState } from '../types';
import { ContextUtils } from '../../utils/contextUtils';
import { StateUtils } from '../../utils/stateUtils';
import { NftClosedMinterProto } from './nftClosedMinterProto';
import { Backtrace } from '../../utils/backtrace';
import { TxUtils } from '../../utils/txUtils';
import { CAT721Proto } from '../cat721Proto';
import { OwnerUtils } from '../../utils/ownerUtils';

export class NftClosedMinter extends SmartContract {
    @prop()
    issuerAddress: ByteString;

    @prop()
    genesisOutpoint: ByteString;

    @prop()
    max: int32;

    constructor(ownerAddress: ByteString, genesisOutpoint: ByteString, max: int32) {
        super(...arguments);
        this.issuerAddress = ownerAddress;
        this.genesisOutpoint = genesisOutpoint;
        this.max = max;
    }

    @method()
    public mint(
        nextStateHashes: StateHashes,
        // args to mint nft
        nftMint: CAT721State,
        issuerPubKeyPrefix: ByteString,
        issuerPubKey: PubKey,
        issuerSig: Sig,
        // output satoshis of curTx minter output
        minterSatoshis: ByteString,
        // output satoshis of curTx nft output
        nftSatoshis: ByteString,
        // state of current spending UTXO, comes from prevTx
        curState: NftClosedMinterState,
        curStateHashes: StateHashes,
        // backtrace
        backtraceInfo: BacktraceInfo,
        // curTx context
        shPreimage: SHPreimage,
        prevoutsCtx: PrevoutsCtx,
        spentScripts: SpentScriptsCtx,
        // curTx change output
        changeInfo: TxOut,
    ) {
        // ctx
        // check sighash preimage
        assert(this.checkSig(ContextUtils.checkSHPreimage(shPreimage), ContextUtils.Gx), 'preimage check error');
        // check prevouts
        const inputCount = ContextUtils.checkPrevoutsCtx(prevoutsCtx, shPreimage.shaPrevouts, shPreimage.inputIndex);
        // back to genesis
        ContextUtils.checkSpentScriptsCtx(spentScripts, shPreimage.shaSpentScripts, inputCount);

        // back to genesis
        const minterScript = spentScripts[Number(prevoutsCtx.inputIndexVal)];
        Backtrace.verifyUnique(backtraceInfo, prevoutsCtx.prevTxHash, this.genesisOutpoint, minterScript);

        // check state of prevTx
        const curStateHash = NftClosedMinterProto.stateHash(curState);
        StateUtils.checkStateHash(
            curStateHashes,
            curStateHash,
            backtraceInfo.prevTxPreimage.hashRoot,
            prevoutsCtx.prevOutputIndexVal,
        );
        const nftRemaining = curState.maxLocalId - curState.nextLocalId;
        assert(nftRemaining > 0n && nftRemaining <= this.max);

        // minter input should be the first input in curTx
        assert(prevoutsCtx.inputIndexVal == 0n);

        // check issuer
        OwnerUtils.checkUserOwner(issuerPubKeyPrefix, issuerPubKey, this.issuerAddress);
        assert(this.checkSig(issuerSig, issuerPubKey));

        let leadingStateRoots = toByteString('');
        let stateCount = 0n;
        // build curTx outputs
        // next minter output
        let minterOutput = toByteString('');
        const nextLocalId = curState.nextLocalId + 1n;
        if (nextLocalId < curState.maxLocalId) {
            minterOutput = TxUtils.buildOutput(minterScript, minterSatoshis);
            leadingStateRoots += hash160(
                NftClosedMinterProto.stateHash({
                    nftScript: curState.nftScript,
                    maxLocalId: curState.maxLocalId,
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
        // state hash root output
        const hashRootOutput = StateUtils.buildStateHashRootOutput(leadingStateRoots, stateCount, nextStateHashes);
        // change output
        const changeOutput = TxUtils.buildChangeOutput(changeInfo);

        // confine curTx outputs
        const shaOutputs = sha256(hashRootOutput + minterOutput + nftOutput + changeOutput);
        assert(shaOutputs == shPreimage.shaOutputs, 'shaOutputs mismatch');
    }
}
