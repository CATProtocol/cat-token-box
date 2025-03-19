import {
    SmartContract,
    prop,
    ByteString,
    method,
    PubKey,
    Sig,
    TxUtils,
    sha256,
    Int32,
    assert,
} from '@scrypt-inc/scrypt-ts-btc';
import { BacktraceInfo } from '@scrypt-inc/scrypt-ts-btc';
import { OwnerUtils } from '../../utils/ownerUtils';
import { CAT721ClosedMinterState, CAT721State } from '../types';
import { CAT721StateLib } from '../cat721State';

export class CAT721ClosedMinter extends SmartContract<CAT721ClosedMinterState> {
    @prop()
    issuerAddress: ByteString;

    @prop()
    genesisOutpoint: ByteString;

    @prop()
    max: Int32;

    constructor(ownerAddress: ByteString, genesisOutpoint: ByteString, max: Int32) {
        super(...arguments);
        this.issuerAddress = ownerAddress;
        this.genesisOutpoint = genesisOutpoint;
        this.max = max;
    }

    @method()
    public mint(
        // args to mint nft
        nftMint: CAT721State,
        issuerPubKeyPrefix: ByteString,
        issuerPubKey: PubKey,
        issuerSig: Sig,
        // output satoshis of curTx minter output
        minterSatoshis: ByteString,
        // output satoshis of curTx nft output
        nftSatoshis: ByteString,
        // backtrace
        backtraceInfo: BacktraceInfo,
    ) {
        // ctx
        this.backtraceToOutpoint(backtraceInfo, this.genesisOutpoint);
        // check issuer
        OwnerUtils.checkUserOwner(issuerPubKeyPrefix, issuerPubKey, this.issuerAddress);
        assert(this.checkSig(issuerSig, issuerPubKey));

        const nftRemaining = this.state.maxLocalId - this.state.nextLocalId;
        assert(nftRemaining > 0n && nftRemaining <= this.max);

        // minter input should be the first input in curTx
        assert(this.ctx.inputIndexVal == 0n);

        // check issuer
        OwnerUtils.checkUserOwner(issuerPubKeyPrefix, issuerPubKey, this.issuerAddress);
        assert(this.checkSig(issuerSig, issuerPubKey));

        const nextLocalId = this.state.nextLocalId + 1n;
        if (nextLocalId < this.state.maxLocalId) {
            this.appendStateOutput(
                TxUtils.buildOutput(this.ctx.spentScript, minterSatoshis),
                CAT721ClosedMinter.stateHash({
                    nftScript: this.state.nftScript,
                    maxLocalId: this.state.maxLocalId,
                    nextLocalId,
                }),
            );
        }
        // next nft output
        assert(nftMint.localId == this.state.nextLocalId);
        this.appendStateOutput(
            TxUtils.buildOutput(this.state.nftScript, nftSatoshis),
            CAT721StateLib.stateHash(nftMint),
        );

        const outputs = this.buildStateOutputs() + this.buildChangeOutput();

        // confine curTx outputs
        assert(sha256(outputs) === this.ctx.shaOutputs, `output hash mismatch`);
    }
}
