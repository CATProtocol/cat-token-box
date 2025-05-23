import { SmartContract, prop, ByteString, method, PubKey, Sig, TxUtils, assert } from '@scrypt-inc/scrypt-ts-btc';
import { OwnerUtils } from '../../utils/ownerUtils.js';
import { CAT20State, CAT20ClosedMinterState } from '../types.js';
import { CAT20StateLib } from '../cat20State.js';
import { BacktraceInfo } from '@scrypt-inc/scrypt-ts-btc';

export class CAT20ClosedMinter extends SmartContract<CAT20ClosedMinterState> {
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
        // backtrace
        backtraceInfo: BacktraceInfo,
    ) {
        // check state of prevTx
        this.backtraceToOutpoint(backtraceInfo, this.genesisOutpoint);

        // check issuer
        OwnerUtils.checkUserOwner(issuerPubKeyPrefix, issuerPubKey, this.issuerAddress);
        assert(this.checkSig(issuerSig, issuerPubKey));

        // build curTx outputs
        // next minter output
        if (minterSatoshis != TxUtils.ZERO_SATS) {
            this.appendStateOutput(
                TxUtils.buildOutput(this.ctx.spentScript, minterSatoshis),
                CAT20ClosedMinter.stateHash(this.state),
            );
        }
        // next token output
        CAT20StateLib.checkState(tokenMint);
        this.appendStateOutput(
            TxUtils.buildOutput(this.state.tokenScript, tokenSatoshis),
            CAT20StateLib.stateHash(tokenMint),
        );

        const outputs = this.buildStateOutputs() + this.buildChangeOutput();
        assert(this.checkOutputs(outputs), 'Outputs mismatch with the transaction context');
    }
}
