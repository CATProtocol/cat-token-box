import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { toTokenAddress } from '../../../../src/lib/utils';
import { CAT20Covenant, OpenMinterCat20Meta } from '../../../../src';
import { deployToken, loadAllArtifacts } from '../utils';
import { testSigner } from '../../../utils/testSigner';
import { bvmVerify, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
use(chaiAsPromised);

describe('Test the feature `deploy` for `openMinterV2Covenant`', () => {
    let metadata: OpenMinterCat20Meta;

    before(async () => {
        loadAllArtifacts();
        const address = await testSigner.getAddress();
        metadata = {
            name: 'c',
            symbol: 'C',
            decimals: 2,
            max: 21000000n,
            limit: 1000n,
            premine: 3150000n,
            preminerAddr: Ripemd160(toTokenAddress(address)),
            minterMd5: '',
        };
    });

    describe('When deploying a new token', () => {
        it('should build and sign the genesis and reveal txns successfully', async () => {
            const { genesisTx, revealTx } = await deployToken(metadata);

            // test genesis(commit) tx
            expect(genesisTx).to.not.be.null;
            expect(bvmVerify(genesisTx, 0)).to.be.true;

            // test reveal tx
            expect(revealTx).to.not.be.null;
            expect(revealTx.isFinalized).to.be.true;

            expect(bvmVerify(revealTx, 0)).to.be.true;
            expect(bvmVerify(revealTx, 1)).to.be.true;
        });

        it('shoud premine the token if applicable', async () => {
            const { premineTx, minterAddr, revealTx } = await deployToken(metadata);

            expect(premineTx).to.not.be.null;
            expect(premineTx!.isFinalized).to.be.true;
            expect(bvmVerify(premineTx!, 0)).to.be.true;
            expect(bvmVerify(revealTx!, 1)).to.be.true;
            expect(bvmVerify(premineTx!, 1)).to.be.true;

            const mintedToken = new CAT20Covenant(minterAddr, {
                amount: metadata.premine * 10n ** BigInt(metadata.decimals),
                ownerAddr: metadata.preminerAddr!,
            });

            const tokenOutputIndex = 3;
            // ensure it has the minted token output
            expect(Buffer.from(premineTx!.txOutputs[tokenOutputIndex].script).toString('hex')).to.eq(
                mintedToken.lockingScript.toHex(),
            );
            // ensure the state hash is correct
            expect(premineTx!.getTxoStateHashes()[tokenOutputIndex - 1]).eq(mintedToken.stateHash);
        });
    });
});
