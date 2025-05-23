import {
    assert,
    BacktraceInfo,
    ByteString,
    Int32,
    method,
    prop,
    PubKey,
    Sig,
    SmartContract,
    TxUtils,
} from '@scrypt-inc/scrypt-ts-btc';
import { OwnerUtils } from '../../utils/ownerUtils.js';
import { CAT721OpenMinterState, CAT721State, MerkleProof, ProofNodePos } from '../types.js';
import { CAT721OpenMinterMerkleTree } from './cat721OpenMinterMerkleTree.js';
import { CAT721StateLib } from '../cat721State.js';

export class CAT721OpenMinter extends SmartContract<CAT721OpenMinterState> {
    @prop()
    genesisOutpoint: ByteString;

    @prop()
    max: Int32;

    @prop()
    premine: Int32;

    @prop()
    preminerAddr: ByteString;

    constructor(genesisOutpoint: ByteString, maxCount: Int32, premine: Int32, premineAddr: ByteString) {
        super(...arguments);
        this.genesisOutpoint = genesisOutpoint;
        this.max = maxCount;
        this.premine = premine;
        this.preminerAddr = premineAddr;
    }

    @method()
    public mint(
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
        // backtrace
        backtraceInfo: BacktraceInfo,
    ) {
        // ctx
        // back to genesis
        this.backtraceToOutpoint(backtraceInfo, this.genesisOutpoint);

        assert(this.state.nextLocalId < this.max);

        // minter input should be the first input in curTx
        assert(this.ctx.inputIndexVal == 0n);

        const commitScript = this.ctx.spentScripts[1];

        const merkleRoot = CAT721OpenMinterMerkleTree.updateLeaf(
            CAT721OpenMinterMerkleTree.leafStateHash({
                commitScript: commitScript,
                localId: this.state.nextLocalId,
                isMined: false,
            }),
            CAT721OpenMinterMerkleTree.leafStateHash({
                commitScript: commitScript,
                localId: this.state.nextLocalId,
                isMined: true,
            }),
            proof,
            proofNodePos,
            this.state.merkleRoot,
        );

        const nextLocalId = this.state.nextLocalId + 1n;
        if (nextLocalId < this.max) {
            this.appendStateOutput(
                TxUtils.buildOutput(this.ctx.spentScript, minterSatoshis),
                CAT721OpenMinter.stateHash({
                    nftScript: this.state.nftScript,
                    merkleRoot,
                    nextLocalId,
                }),
            );
        }
        // next nft output
        CAT721StateLib.checkState(nftMint);
        assert(nftMint.localId == this.state.nextLocalId);
        this.appendStateOutput(
            TxUtils.buildOutput(this.state.nftScript, nftSatoshis),
            CAT721StateLib.stateHash(nftMint),
        );

        if (nftMint.localId < this.premine) {
            // preminer checksig
            OwnerUtils.checkUserOwner(preminerPubKeyPrefix, preminerPubKey, this.preminerAddr);
            assert(this.checkSig(preminerSig, preminerPubKey));
        }

        // confine curTx outputs
        const outputs = this.buildStateOutputs() + this.buildChangeOutput();
        assert(this.checkOutputs(outputs), 'Outputs mismatch with the transaction context');
    }
}
