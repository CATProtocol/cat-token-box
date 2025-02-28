import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Ripemd160 } from 'scrypt-ts';
import { NftParallelClosedMinterCat721Meta } from '../../../../src/lib/metadata';
import { verifyInputSpent } from '../../../utils/txHelper';
import { CatPsbt } from '../../../../src/lib/catPsbt';
import { CAT721Covenant } from '../../../../src/covenants/cat721Covenant';
import { testSigner } from '../../../utils/testSigner';
import {
    ALLOWED_SIZE_DIFF as ALLOWED_VSIZE_DIFF,
    deployNft,
    FEE_RATE,
    mintNft,
} from '../nftParallelClosedMinter.utils';
import { NftGuard } from '../../../../src/contracts/nft/nftGuard';
import { NftParallelClosedMinterCovenant } from '../../../../src/covenants/nftParallelClosedMinterCovenant';
import { NftParallelClosedMinter } from '../../../../src/contracts/nft/minters/nftParallelClosedMinter';
import { CAT721Proto } from '../../../../src/contracts/nft/cat721Proto';
import { CAT721 } from '../../../../src/contracts/nft/cat721';
import { toTokenAddress } from '../../../../src/lib/utils';
import { Cat721MinterUtxo } from '../../../../src/lib/provider';

use(chaiAsPromised);

describe('Test the feature `mint` for `NftParallelClosedMinterCovenant`', () => {
    let address: string;
    let nftReceiverAddr: Ripemd160;

    let collectionId: string;
    let metadata: NftParallelClosedMinterCat721Meta;

    let spentMinterTx: CatPsbt;

    before(async () => {
        await CAT721.loadArtifact();
        await NftGuard.loadArtifact();
        await NftParallelClosedMinter.loadArtifact();
        address = await testSigner.getAddress();
        nftReceiverAddr = toTokenAddress(address);
        metadata = {
            name: 'Locked-up Cats',
            symbol: 'LCAT',
            max: 10000n,
            minterMd5: NftParallelClosedMinterCovenant.LOCKED_ASM_VERSION,
            description:
                'It’s the first NFT collection distributed on the Bitcoin Network based on the brand new CAT721 protocol.',
        };

        const { revealTx, collectionId: deployedTokenId } = await deployNft(metadata);
        collectionId = deployedTokenId;
        spentMinterTx = revealTx;
    });

    describe('When minting an existed nft', () => {
        it('should mint a new nft successfully', async () => {
            // use the second minter in previous outputs
            const minterOutputIndex = 1;

            const spentMinter = NftParallelClosedMinterCovenant.fromMintTx(
                collectionId,
                nftReceiverAddr,
                metadata,
                spentMinterTx.extractTransaction().toHex(),
                minterOutputIndex,
            );

            await testMintResult(spentMinter, minterOutputIndex);
        });
    });

    async function testMintResult(inputMinter: NftParallelClosedMinterCovenant, spentMinterOutputIndex: number) {
        const tx = spentMinterTx.extractTransaction();
        const cat721MinterUtxo: Cat721MinterUtxo = {
            utxo: {
                txId: tx.getId(),
                outputIndex: spentMinterOutputIndex,
                satoshis: Number(tx.outs[spentMinterOutputIndex].value),
                script: Buffer.from(tx.outs[spentMinterOutputIndex].script).toString('hex'),
            },
            txoStateHashes: spentMinterTx.txState.stateHashList,
            state: inputMinter.state!,
        };

        const { mintTx, estMintTxVSize } = await mintNft(cat721MinterUtxo, collectionId, metadata);

        expect(mintTx).to.not.be.null;
        expect(mintTx.isFinalized).to.be.true;

        // ensure the spentMinter is spent
        expect(verifyInputSpent(mintTx, 0)).to.be.true;

        const realVSize = mintTx.extractTransaction().virtualSize();
        expect(
            estMintTxVSize >= realVSize,
            `Estimated tx size ${estMintTxVSize} is less than the real size ${realVSize}`,
        ).to.be.true;
        expect(
            estMintTxVSize - realVSize <= ALLOWED_VSIZE_DIFF,
            `Estimated tx size ${estMintTxVSize} is too large than the real size ${realVSize}`,
        ).to.be.true;
        expect(
            mintTx.getFeeRate() <= (estMintTxVSize / realVSize) * FEE_RATE,
            `Mint tx fee rate ${mintTx.getFeeRate()} is larger than the expected fee rate ${
                (estMintTxVSize / realVSize) * FEE_RATE
            }`,
        );
        const contract = inputMinter.getSubContract() as NftParallelClosedMinter;
        inputMinter.state?.nextLocalId;
        const nextLocalId = inputMinter.state!.nextLocalId;
        const nextLocalIds = [nextLocalId + nextLocalId + 1n, nextLocalId + nextLocalId + 2n];
        let nftOutputIndex = 1;
        nextLocalIds.forEach((value, index) => {
            if (value < contract.max) {
                nftOutputIndex += 1;
                const nextMinter = new NftParallelClosedMinterCovenant(nftReceiverAddr, collectionId, metadata, {
                    nftScript: inputMinter.nftScript,
                    nextLocalId: value,
                });
                expect(Buffer.from(mintTx.txOutputs[index + 1].script).toString('hex')).to.eq(
                    nextMinter.lockingScript.toHex(),
                );
                expect(mintTx.txState.stateHashList[index], `incorrect minter state on outputs[${index + 1}]`).eq(
                    nextMinter.stateHash,
                );
            }
        });

        // ensure the minted nft is sent to the receiver
        const mintedToken = new CAT721Covenant(
            inputMinter.address,
            CAT721Proto.create(inputMinter.state!.nextLocalId, nftReceiverAddr),
        );
        expect(Buffer.from(mintTx.txOutputs[nftOutputIndex].script).toString('hex')).to.eq(
            mintedToken.lockingScript.toHex(),
        );
        expect(mintTx.txState.stateHashList[nftOutputIndex - 1]).eq(mintedToken.stateHash);

        // update the references
        spentMinterTx = mintTx;
    }
});
