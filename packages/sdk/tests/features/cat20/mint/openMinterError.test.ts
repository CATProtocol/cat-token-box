import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { bvmVerify, ExtPsbt, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import {
    addrToP2trLockingScript,
    CAT20Covenant,
    CAT20OpenMinterCovenant,
    OpenMinterCat20Meta,
    Postage,
    toTokenAddress,
    CAT20OpenMinterUtxo,
    mint,
} from '@cat-protocol/cat-sdk-v2';
import { deployToken, loadAllArtifacts } from '../utils';
import { testErrorSigner } from '../../../utils/testSigner';
import { testChainProvider, testUtxoProvider } from '../../../utils/testProvider';

use(chaiAsPromised);

describe('Test the feature `mint` for `CAT20OpenMinterCovenant`', () => {
    let address: string;
    let tokenReceiverAddr: Ripemd160;

    let tokenId: string;
    let tokenAddr: string;
    let minterAddr: string;
    let metadata: OpenMinterCat20Meta;

    let spentMinterTx: ExtPsbt;

    before(async () => {
        loadAllArtifacts();
        address = await testErrorSigner.getAddress();
        tokenReceiverAddr = Ripemd160(toTokenAddress(address));
        metadata = {
            name: 'c',
            symbol: 'C',
            decimals: 2,
            max: 21000000n,
            limit: 1000n,
            premine: 3150000n,
            preminerAddr: tokenReceiverAddr,
            minterMd5: '',
        };

        const {
            revealTx,
            tokenId: deployedTokenId,
            tokenAddr: deployedTokenAddr,
            minterAddr: deployedMinterAddr,
        } = await deployToken(metadata);
        tokenId = deployedTokenId;
        tokenAddr = deployedTokenAddr;
        spentMinterTx = revealTx;
        minterAddr = deployedMinterAddr;
    });

    describe('When minting an existed token', () => {
        it('should failed mint the premined tokens use incorrect signer', async () => {
            const cat20MinterUtxo: CAT20OpenMinterUtxo = {
                txId: spentMinterTx.extractTransaction().getId(),
                outputIndex: 1,
                script: addrToP2trLockingScript(minterAddr),
                satoshis: Postage.MINTER_POSTAGE,
                txHashPreimage: spentMinterTx.txHashPreimage(),
                txoStateHashes: spentMinterTx.getTxoStateHashes(),
                state: {
                    tokenScript: addrToP2trLockingScript(tokenAddr),
                    hasMintedBefore: false,
                    remainingCount: (metadata.max - metadata.premine) / metadata.limit,
                },
            };

            return expect(
                testMintResult(cat20MinterUtxo, minterAddr, [8925n, 8925n], 3150000n * 100n),
            ).to.eventually.be.rejectedWith('signature check failed');
        });
    });

    async function testMintResult(
        cat20MinterUtxo: CAT20OpenMinterUtxo,
        minterAddr: string,
        expectedNextMinterCounts: bigint[],
        expectedMintedAmount: bigint,
    ) {
        const { mintTx } = await mint(
            testErrorSigner,
            testUtxoProvider,
            testChainProvider,
            cat20MinterUtxo,
            tokenId,
            metadata,
            tokenReceiverAddr,
            address,
            await testChainProvider.getFeeRate(),
        );

        expect(mintTx).to.not.be.null;
        expect(mintTx.isFinalized).to.be.true;

        // ensure the spentMinter is spent
        expect(bvmVerify(mintTx, 0)).to.be.true;

        let outputIndex = 1;
        for (let i = 0; i < expectedNextMinterCounts.length; i++) {
            // ensure a new minter is created
            const nextMinterOutputIndex = outputIndex++;
            const nextMinter = new CAT20OpenMinterCovenant(tokenId, metadata, {
                tokenScript: cat20MinterUtxo.state.tokenScript,
                hasMintedBefore: true,
                remainingCount: expectedNextMinterCounts[i],
            });
            expect(Buffer.from(mintTx.txOutputs[nextMinterOutputIndex].script).toString('hex')).to.eq(
                nextMinter.lockingScript.toHex(),
            );
            expect(
                mintTx.getTxoStateHashes()[nextMinterOutputIndex - 1],
                `incorrect minter state on outputs[${nextMinterOutputIndex}]`,
            ).eq(nextMinter.stateHash);
        }

        // ensure the minted token is sent to the receiver
        const tokenOutputIndex = outputIndex;
        const mintedToken = new CAT20Covenant(minterAddr, {
            amount: expectedMintedAmount,
            ownerAddr: tokenReceiverAddr,
        });
        expect(Buffer.from(mintTx.txOutputs[tokenOutputIndex].script).toString('hex')).to.eq(
            mintedToken.lockingScript.toHex(),
        );
        expect(mintTx.getTxoStateHashes()[tokenOutputIndex - 1]).eq(mintedToken.stateHash);

        // update the references
        spentMinterTx = mintTx;
    }
});
