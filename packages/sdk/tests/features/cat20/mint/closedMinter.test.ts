import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { bvmVerify, ExtPsbt, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import {
    addrToP2trLockingScript,
    CAT20Covenant,
    CAT20ClosedMinterCovenant,
    ClosedMinterCat20Meta,
    Postage,
    toTokenAddress,
    CAT20ClosedMinterUtxo,
} from '@cat-protocol/cat-sdk-v2';
import { deployClosedMinterToken, loadAllArtifacts, mintClosedMinterToken } from '../utils';
import { testSigner } from '../../../utils/testSigner';

use(chaiAsPromised);

describe('Test the feature `mint` for `CAT20ClosedMinterCovenant`', () => {
    let address: string;
    let tokenReceiverAddr: Ripemd160;

    let tokenId: string;
    let tokenAddr: string;
    let minterAddr: string;
    let metadata: ClosedMinterCat20Meta;

    let spentMinterTx: ExtPsbt;

    before(async () => {
        loadAllArtifacts();
        // await OpenMinter.loadArtifact();
        // await CAT20.loadArtifact();
        // await Guard.loadArtifact();
        address = await testSigner.getAddress();
        tokenReceiverAddr = Ripemd160(toTokenAddress(address));
        metadata = {
            name: 'c',
            symbol: 'C',
            decimals: 2,
            minterMd5: '',
        };

        const {
            revealTx,
            tokenId: deployedTokenId,
            tokenAddr: deployedTokenAddr,
            minterAddr: deployedMinterAddr,
        } = await deployClosedMinterToken(metadata);
        tokenId = deployedTokenId;
        tokenAddr = deployedTokenAddr;
        spentMinterTx = revealTx;
        minterAddr = deployedMinterAddr;
    });

    describe('When minting an deployed token', () => {
        it('should mint the first tokens successfully', async () => {
            const cat20MinterUtxo: CAT20ClosedMinterUtxo = {
                txId: spentMinterTx.extractTransaction().getId(),
                outputIndex: 1,
                script: addrToP2trLockingScript(minterAddr),
                satoshis: Postage.MINTER_POSTAGE,
                txHashPreimage: spentMinterTx.txHashPreimage(),
                txoStateHashes: spentMinterTx.getTxoStateHashes(),
                state: {
                    tokenScript: addrToP2trLockingScript(tokenAddr),
                },
            };

            await testMintResult(cat20MinterUtxo, minterAddr, 3150000n * 100n);
        });

        it('should mint a new token successfully', async () => {
            // use the second minter in previous outputs
            const minterOutputIndex = 1;

            const cat20MinterUtxo: CAT20ClosedMinterUtxo = {
                txId: spentMinterTx.extractTransaction().getId(),
                outputIndex: minterOutputIndex,
                script: addrToP2trLockingScript(minterAddr),
                satoshis: Postage.MINTER_POSTAGE,
                txHashPreimage: spentMinterTx.txHashPreimage(),
                txoStateHashes: spentMinterTx.getTxoStateHashes(),
                state: {
                    tokenScript: addrToP2trLockingScript(tokenAddr),
                },
            };

            await testMintResult(cat20MinterUtxo, minterAddr, 1000n * 100n);
        });
    });

    async function testMintResult(
        cat20MinterUtxo: CAT20ClosedMinterUtxo,
        minterAddr: string,
        expectedMintedAmount: bigint,
    ) {
        const { mintTx } = await mintClosedMinterToken(cat20MinterUtxo, tokenId, metadata, expectedMintedAmount);

        expect(mintTx).to.not.be.null;
        expect(mintTx.isFinalized).to.be.true;

        // ensure the spentMinter is spent
        expect(bvmVerify(mintTx, 0)).to.be.true;

        let outputIndex = 1;
        // ensure a new minter is created
        const nextMinterOutputIndex = outputIndex++;
        const nextMinter = new CAT20ClosedMinterCovenant(tokenId, address, metadata, {
            tokenScript: cat20MinterUtxo.state.tokenScript,
        });
        expect(Buffer.from(mintTx.txOutputs[nextMinterOutputIndex].script).toString('hex')).to.eq(
            nextMinter.lockingScript.toHex(),
        );
        expect(
            mintTx.getTxoStateHashes()[nextMinterOutputIndex - 1],
            `incorrect minter state on outputs[${nextMinterOutputIndex}]`,
        ).eq(nextMinter.stateHash);

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
