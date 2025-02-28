import { method, SmartContract, assert, prop, ByteString, sha256, PubKey, Sig, hash160, toByteString } from 'scrypt-ts';
import { BacktraceInfo, TxOut, PrevoutsCtx, SHPreimage, SpentScriptsCtx, StateHashes } from '../../types';
import { CAT20State, ClosedMinterState } from '../types';
import { ContextUtils } from '../../utils/contextUtils';
import { StateUtils } from '../../utils/stateUtils';
import { ClosedMinterProto } from './closedMinterProto';
import { Backtrace } from '../../utils/backtrace';
import { TxUtils } from '../../utils/txUtils';
import { CAT20Proto } from '../cat20Proto';
import { OwnerUtils } from '../../utils/ownerUtils';

export class ClosedMinter extends SmartContract {
    @prop()
    issuerAddress: ByteString;

    @prop()
    genesisOutpoint: ByteString;

    constructor(ownerAddress: ByteString, genesisOutpoint: ByteString) {
        super(...arguments);
        this.issuerAddress = ownerAddress;
        this.genesisOutpoint = genesisOutpoint;
    }

    @method()
    public mint(
        nextStateHashes: StateHashes,
        // args to mint token
        tokenMint: CAT20State,
        issuerPubKeyPrefix: ByteString,
        issuerPubKey: PubKey,
        issuerSig: Sig,
        // output satoshis of curTx minter output
        // if the token is fixed supply, or the token is non-mintable anymore, then this value is 0
        minterSatoshis: ByteString,
        // output satoshis of curTx token output
        tokenSatoshis: ByteString,
        // state of current spending UTXO, comes from prevTx
        curState: ClosedMinterState,
        curStateHashes: StateHashes,
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
        const curStateHash = ClosedMinterProto.stateHash(curState);
        StateUtils.checkStateHash(
            curStateHashes,
            curStateHash,
            backtraceInfo.prevTxPreimage.hashRoot,
            prevoutsCtx.prevOutputIndexVal,
        );

        // check issuer
        OwnerUtils.checkUserOwner(issuerPubKeyPrefix, issuerPubKey, this.issuerAddress);
        assert(this.checkSig(issuerSig, issuerPubKey));

        let leadingStateRoots = toByteString('');
        let stateCount = 0n;
        // build curTx outputs
        // next minter output
        let minterOutput = toByteString('');
        if (minterSatoshis != TxUtils.ZERO_SATS) {
            minterOutput = TxUtils.buildOutput(minterScript, minterSatoshis);
            leadingStateRoots += hash160(curStateHash); // the state of next closedMinter does not change
            stateCount++;
        }
        // next token output
        const tokenOutput = TxUtils.buildOutput(curState.tokenScript, tokenSatoshis);
        leadingStateRoots += hash160(CAT20Proto.stateHash(tokenMint));
        stateCount++;
        // state hash root output
        const hashRootOutput = StateUtils.buildStateHashRootOutput(leadingStateRoots, stateCount, nextStateHashes);
        // change output
        const changeOutput = TxUtils.buildChangeOutput(changeInfo);

        // confine curTx outputs
        const shaOutputs = sha256(hashRootOutput + minterOutput + tokenOutput + changeOutput);
        assert(shaOutputs == shPreimage.shaOutputs, 'shaOutputs mismatch');
    }
}
