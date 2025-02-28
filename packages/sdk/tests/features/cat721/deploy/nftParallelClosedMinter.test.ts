import * as dotenv from 'dotenv';
dotenv.config();
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NftParallelClosedMinterCat721Meta } from '../../../../src/lib/metadata';
import { NftParallelClosedMinter } from '../../../../src/contracts/nft/minters/nftParallelClosedMinter';
import { verifyInputSpent } from '../../../utils/txHelper';
import { CAT721 } from '../../../../src/contracts/nft/cat721';
import { ALLOWED_SIZE_DIFF, deployNft, FEE_RATE } from '../nftParallelClosedMinter.utils';
import { NftGuard } from '../../../../src/contracts/nft/nftGuard';
import { NftParallelClosedMinterCovenant } from '../../../../src/covenants/nftParallelClosedMinterCovenant';

use(chaiAsPromised);

describe('Test the feature `deploy` for `NftParallelClosedMinterCovenant`', () => {
    let metadata: NftParallelClosedMinterCat721Meta;

    before(async () => {
        await NftParallelClosedMinter.loadArtifact();
        await CAT721.loadArtifact();
        await NftGuard.loadArtifact();
        metadata = {
            name: 'Locked-up Cats',
            symbol: 'LCAT',
            max: 10000n,
            minterMd5: NftParallelClosedMinterCovenant.LOCKED_ASM_VERSION,
            description:
                'It’s the first NFT collection distributed on the Bitcoin Network based on the brand new CAT721 protocol.',
        };
    });

    describe('When deploying a new nft', () => {
        it('should build and sign the genesis and reveal txns successfully', async () => {
            const { genesisTx, revealTx, estRevealTxVSize, estGenesisTxVSize } = await deployNft(metadata);

            // test genesis(commit) tx
            expect(genesisTx).to.not.be.null;
            expect(verifyInputSpent(genesisTx, 0)).to.be.true;

            // test reveal tx
            expect(revealTx).to.not.be.null;
            expect(revealTx.isFinalized).to.be.true;
            expect(verifyInputSpent(revealTx, 0)).to.be.true;
            expect(verifyInputSpent(revealTx, 1)).to.be.true;

            // test virutal size estimation

            const realCommitTxSize = genesisTx.extractTransaction().virtualSize();
            const realRevealTxSize = revealTx.extractTransaction().virtualSize();

            expect(
                estGenesisTxVSize >= realCommitTxSize,
                `Estimated commitTx size ${estGenesisTxVSize} is less than the real size ${realCommitTxSize}`,
            ).to.be.true;
            expect(
                estGenesisTxVSize - realCommitTxSize <= ALLOWED_SIZE_DIFF,
                `Estimated commitTx size ${estGenesisTxVSize} is too large than the real size ${realCommitTxSize}`,
            ).to.be.true;
            expect(
                genesisTx.getFeeRate() <= (estGenesisTxVSize / realCommitTxSize) * FEE_RATE,
                `Genesis tx fee rate ${genesisTx.getFeeRate()} is larger than the expected fee rate ${
                    (estGenesisTxVSize / realCommitTxSize) * FEE_RATE
                }`,
            ).to.be.true;
            expect(
                estRevealTxVSize >= realRevealTxSize,
                `Estimated revealTx size ${estRevealTxVSize} is less than the real size ${realRevealTxSize}`,
            ).to.be.true;
            expect(
                estRevealTxVSize - realRevealTxSize <= ALLOWED_SIZE_DIFF,
                `Estimated revealTx size ${estRevealTxVSize} is too large than the real size ${realRevealTxSize}`,
            ).to.be.true;
            expect(
                revealTx.getFeeRate() <= (estRevealTxVSize / realRevealTxSize) * FEE_RATE,
                `Reveal tx fee rate ${revealTx.getFeeRate()} is larger than the expected fee rate ${
                    (estRevealTxVSize / realRevealTxSize) * FEE_RATE
                }`,
            ).to.be.true;
        });
    });
});
