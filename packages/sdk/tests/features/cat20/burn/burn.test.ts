import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Ripemd160 } from 'scrypt-ts';
import { OpenMinterCat20Meta } from '../../../../src/lib/metadata';
import { OpenMinter } from '../../../../src/contracts/token/minters/openMinter';
import { verifyInputSpent } from '../../../utils/txHelper';
import { CAT20 } from '../../../../src/contracts/token/cat20';
import { CatPsbt } from '../../../../src/lib/catPsbt';
import { testSigner } from '../../../utils/testSigner';
import { Guard } from '../../../../src/contracts/token/guard';
import { ALLOWED_SIZE_DIFF, burnToken, deployToken, FEE_RATE, mintToken } from '../openMinter.utils';
import { CAT20Proto } from '../../../../src/contracts/token/cat20Proto';
import { Cat20MinterUtxo, Cat20Utxo } from '../../../../src/lib/provider';
import { OpenMinterCovenant } from '../../../../src/covenants/openMinterCovenant';
import { addrToP2trLockingScript, toTokenAddress } from '../../../../src/lib/utils';
import { Postage } from '../../../../src/lib/constants';

use(chaiAsPromised);

describe('Test the feature `burn` for `Cat20Covenant`', () => {
    let toReceiverAddr: Ripemd160;

    let tokenId: string;
    let tokenAddr: string;
    let minterAddr: string;
    let metadata: OpenMinterCat20Meta;

    let firstMintTx: CatPsbt;
    let secondMintTx: CatPsbt;

    before(async () => {
        await OpenMinter.loadArtifact();
        await CAT20.loadArtifact();
        await Guard.loadArtifact();
        const address = await testSigner.getAddress();
        toReceiverAddr = toTokenAddress(address);

        metadata = {
            name: 'c',
            symbol: 'C',
            decimals: 2,
            max: 21000000n,
            limit: 1000n,
            premine: 3150000n,
            preminerAddr: toReceiverAddr,
            minterMd5: OpenMinterCovenant.LOCKED_ASM_VERSION,
        };

        const {
            tokenId: deployedTokenId,
            tokenAddr: deployedTokenAddr,
            minterAddr: deployedMinterAddr,
            premineTx,
        } = await deployToken(metadata);

        tokenId = deployedTokenId;
        tokenAddr = deployedTokenAddr;
        minterAddr = deployedMinterAddr;

        firstMintTx = premineTx!;

        const cat20MinterUtxo: Cat20MinterUtxo = {
            utxo: {
                txId: premineTx!.extractTransaction().getId(),
                outputIndex: 1,
                script: addrToP2trLockingScript(minterAddr),
                satoshis: Postage.MINTER_POSTAGE,
            },
            txoStateHashes: premineTx!.getTxStatesInfo().stateHashes,
            state: { tokenScript: addrToP2trLockingScript(tokenAddr), hasMintedBefore: true, remainingCount: 8925n },
        };

        const { mintTx } = await mintToken(cat20MinterUtxo, tokenId, metadata);

        secondMintTx = mintTx;
    });

    describe('When burn tokens in a single tx', () => {
        it('should burn one token utxo successfully', async () => {
            await testBurnResult([
                {
                    utxo: firstMintTx.getUtxo(3),
                    txoStateHashes: firstMintTx.txState.stateHashList,
                    state: CAT20Proto.create(metadata.premine * 10n ** BigInt(metadata.decimals), toReceiverAddr),
                },
            ]);
        });

        it('should burn multiple token utxos successfully', async () => {
            await testBurnResult([
                // first token utxo
                {
                    utxo: firstMintTx.getUtxo(3),
                    txoStateHashes: firstMintTx.txState.stateHashList,
                    state: CAT20Proto.create(metadata.premine * 10n ** BigInt(metadata.decimals), toReceiverAddr),
                },
                // second token utxo
                {
                    utxo: secondMintTx.getUtxo(3),
                    txoStateHashes: secondMintTx.txState.stateHashList,
                    state: CAT20Proto.create(metadata.limit * 10n ** BigInt(metadata.decimals), toReceiverAddr),
                },
            ]);
        });
    });

    async function testBurnResult(cat20Utxos: Cat20Utxo[]) {
        const { guardTx, burnTx, estGuardTxVSize, estSendTxVSize } = await burnToken(minterAddr, cat20Utxos);

        const realGuardVSize = guardTx.extractTransaction().virtualSize();
        const realSendVSize = burnTx.extractTransaction().virtualSize();

        // check guard tx
        expect(guardTx).not.to.be.undefined;
        expect(guardTx.isFinalized).to.be.true;
        expect(
            estGuardTxVSize >= realGuardVSize,
            `Estimated guard tx size ${estGuardTxVSize} is less that the real size ${realGuardVSize}`,
        ).to.be.true;
        expect(
            estGuardTxVSize <= realGuardVSize + ALLOWED_SIZE_DIFF,
            `Estimated guard tx size ${estGuardTxVSize} is more than the real size ${realGuardVSize}`,
        ).to.be.true;
        expect(
            guardTx.getFeeRate() <= (estGuardTxVSize / realGuardVSize) * FEE_RATE,
            `Guard tx fee rate ${guardTx.getFeeRate()} is large than the expected fee rate ${
                (estGuardTxVSize / realGuardVSize) * FEE_RATE
            }`,
        ).to.be.true;

        // check send tx
        expect(burnTx).not.to.be.undefined;
        expect(burnTx.isFinalized).to.be.true;
        expect(
            estSendTxVSize >= realSendVSize,
            `Estimated send tx size ${estSendTxVSize} is less that the real size ${realSendVSize}`,
        ).to.be.true;
        expect(
            estSendTxVSize <= realSendVSize + ALLOWED_SIZE_DIFF,
            `Estimated send tx size ${estSendTxVSize} is more than the real size ${realSendVSize}`,
        ).to.be.true;
        expect(
            burnTx.getFeeRate() <= (estSendTxVSize / realSendVSize) * FEE_RATE,
            `Send tx fee rate ${burnTx.getFeeRate()} is larger than the expected fee rate ${
                (estSendTxVSize / realSendVSize) * FEE_RATE
            }`,
        ).to.be.true;

        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(verifyInputSpent(burnTx, i)).to.be.true;
        }

        // verify guard input unlock
        expect(verifyInputSpent(burnTx, cat20Utxos.length)).to.be.true;
    }
});
