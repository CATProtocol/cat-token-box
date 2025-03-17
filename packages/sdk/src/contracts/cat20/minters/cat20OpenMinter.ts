import {
    assert,
    ByteString,
    FixedArray,
    Int32,
    method,
    prop,
    PubKey,
    sha256,
    Sig,
    SmartContract,
    TxUtils,
} from '@scrypt-inc/scrypt-ts-btc';
import { BacktraceInfo } from '@scrypt-inc/scrypt-ts-btc';
import { OwnerUtils } from '../../utils/ownerUtils';
import { CAT20State, CAT20OpenMinterState } from '../types';
import { CAT20StateLib } from '../cat20State';

const MAX_NEXT_MINTERS = 2;

export class CAT20OpenMinter extends SmartContract<CAT20OpenMinterState> {
    @prop()
    genesisOutpoint: ByteString;

    // token max supply == this.maxCount * this.limit
    @prop()
    maxCount: Int32;

    // this.premine == this.preminerCount * this.limit
    @prop()
    premine: Int32;

    @prop()
    premineCount: Int32;

    @prop()
    limit: Int32;

    @prop()
    preminerAddr: ByteString;

    constructor(
        genesisOutpoint: ByteString,
        maxCount: Int32,
        premine: Int32,
        premineCount: Int32,
        limit: Int32,
        premineAddr: ByteString,
    ) {
        super(...arguments);
        this.genesisOutpoint = genesisOutpoint;
        this.maxCount = maxCount;
        // this assumes this.premineCount * this.limit == this.premine,
        // which can be trivially validated by anyone after the token is deployed
        this.premine = premine;
        this.premineCount = premineCount;
        this.limit = limit;
        this.preminerAddr = premineAddr;
    }

    @method()
    public mint(
        // args to mint token
        tokenMint: CAT20State,
        nextRemainingCounts: FixedArray<Int32, typeof MAX_NEXT_MINTERS>,
        // premine related args
        preminerPubKeyPrefix: ByteString,
        preminerPubKey: PubKey,
        preminerSig: Sig,
        // output satoshis of curTx minter output
        minterSatoshis: ByteString,
        // output satoshis of curTx token output
        tokenSatoshis: ByteString,
        // state of current spending UTXO, comes from prevTx
        // backtrace
        backtraceInfo: BacktraceInfo,
    ) {
        // back to genesis
        this.backtraceToOutpoint(backtraceInfo, this.genesisOutpoint);

        // build curTx outputs
        // split to multiple next openMinters
        let sumNextRemainingCount = 0n;
        for (let i = 0; i < MAX_NEXT_MINTERS; i++) {
            const remainingCount = nextRemainingCounts[i];
            if (remainingCount > 0n) {
                sumNextRemainingCount += remainingCount;
                this.appendStateOutput(
                    TxUtils.buildOutput(this.ctx.spentScript, minterSatoshis),
                    CAT20OpenMinter.stateHash({
                        tokenScript: this.state.tokenScript,
                        hasMintedBefore: true,
                        remainingCount,
                    }),
                );
            }
        }

        // next token output
        // const tokenOutput = TxUtils.buildOutput(this.state.tokenScript, tokenSatoshis);
        // leadingStateRoots += hash160(CAT20Proto.stateHash(tokenMint));
        // stateCount++;
        this.appendStateOutput(
            TxUtils.buildOutput(this.state.tokenScript, tokenSatoshis),
            CAT20StateLib.stateHash(tokenMint),
        );
        if (!this.state.hasMintedBefore && this.premine > 0n) {
            // needs to premine
            assert(this.maxCount == this.state.remainingCount + this.premineCount);
            // preminer checksig
            OwnerUtils.checkUserOwner(preminerPubKeyPrefix, preminerPubKey, this.preminerAddr);
            assert(this.checkSig(preminerSig, preminerPubKey));
            // premine dees not affect this.state.remainingCount
            assert(sumNextRemainingCount == this.state.remainingCount);
            assert(tokenMint.amount == this.premine);
        } else {
            // general mint
            if (!this.state.hasMintedBefore) {
                // this is the first time mint
                assert(this.maxCount == this.state.remainingCount);
                assert(this.premineCount == 0n);
                assert(this.premine == 0n);
            }
            assert(sumNextRemainingCount == this.state.remainingCount - 1n);
            assert(tokenMint.amount == this.limit);
        }

        const outputs = this.buildStateOutputs() + this.buildChangeOutput();

        // confine curTx outputs
        assert(sha256(outputs) === this.ctx.shaOutputs, `output hash mismatch`);
    }
}
