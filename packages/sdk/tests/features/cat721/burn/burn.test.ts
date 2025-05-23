import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { bvmVerify } from '@scrypt-inc/scrypt-ts-btc';
import { NftParallelClosedMinterCat721Meta, CAT721Utxo, burnNft } from '@cat-protocol/cat-sdk-v2';
import { loadAllArtifacts } from '../utils';
import { testSigner } from '../../../utils/testSigner';
import { TestCAT721Generater } from '../../../utils/testCAT721Generater';
import { testChainProvider, testUtxoProvider } from '../../../utils/testProvider';

use(chaiAsPromised);

describe('Test the feature `burn` for `CAT721Covenant`', () => {
    let address: string;
    let metadata: NftParallelClosedMinterCat721Meta;
    let nftGenerater: TestCAT721Generater;

    before(async () => {
        loadAllArtifacts();

        address = await testSigner.getAddress();

        metadata = {
            name: 'Locked-up Cats',
            symbol: 'LCAT',
            max: 10000n,
            minterMd5: '',
            description:
                'It’s the first NFT collection distributed on the Bitcoin Network based on the brand new CAT721 protocol.',
        };

        nftGenerater = await TestCAT721Generater.init(metadata);
    });

    const getNftUtxos = async function (generater: TestCAT721Generater, address: string, n: number) {
        const r: CAT721Utxo[] = [];
        for (let index = 0; index < n; index++) {
            const utxo = await generater.mintNFtToAddr(address);
            r.push(utxo);
        }
        return r;
    };

    describe('When burn nfts in a single tx', () => {
        it('should burn one nft utxo successfully', async () => {
            const nftUtxos = await getNftUtxos(nftGenerater, address, 1);
            await testBurnResult(nftUtxos);
        });

        it('should burn multiple nft utxos successfully', async () => {
            const nftUtxos = await getNftUtxos(nftGenerater, address, 2);
            await testBurnResult(nftUtxos);
        });
    });

    async function testBurnResult(cat721Utxos: CAT721Utxo[]) {
        const { guardTx, burnTx } = await burnNft(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            nftGenerater.deployInfo.minterAddr,
            cat721Utxos,
            await testChainProvider.getFeeRate(),
        );

        // check guard tx
        expect(guardTx).not.to.be.undefined;
        expect(guardTx.isFinalized).to.be.true;

        // check send tx
        expect(burnTx).not.to.be.undefined;
        expect(burnTx.isFinalized).to.be.true;

        // verify token input unlock
        for (let i = 0; i < cat721Utxos.length; i++) {
            expect(bvmVerify(burnTx, i)).to.be.true;
        }

        // verify guard input unlock
        expect(bvmVerify(burnTx, cat721Utxos.length)).to.be.true;
    }
});
