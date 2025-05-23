import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { bvmVerify, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import { OpenMinterCat20Meta, toTokenAddress, burn, CAT20Utxo } from '@cat-protocol/cat-sdk-v2';
import { testSigner } from '../../../utils/testSigner';
import { TestCAT20Generater } from '../../../utils/testCAT20Generater';
import { testChainProvider, testUtxoProvider } from '../../../utils/testProvider';
import { loadAllArtifacts } from '../utils';

use(chaiAsPromised);

describe('Test the feature `burn` for `Cat20Covenant`', () => {
    let toReceiverAddr: Ripemd160;
    let metadata: OpenMinterCat20Meta;
    let cat20Generater: TestCAT20Generater;

    before(async () => {
        loadAllArtifacts();
        const address = await testSigner.getAddress();
        toReceiverAddr = Ripemd160(toTokenAddress(address));

        metadata = {
            name: 'c',
            symbol: 'C',
            decimals: 2,
            max: 21000000n,
            limit: 1000n,
            premine: 3150000n,
            preminerAddr: toReceiverAddr,
            minterMd5: '',
        };
        cat20Generater = await TestCAT20Generater.init(metadata);
    });

    const getTokenUtxos = async function (generater: TestCAT20Generater, toReceiverAddr: string, n: number) {
        const r: CAT20Utxo[] = [];
        for (let index = 0; index < n; index++) {
            const utxo = await generater.mintTokenToHash160(
                toReceiverAddr,
                BigInt(Math.floor(Math.random() * 1000000)),
            );
            r.push(utxo);
        }
        return r;
    };

    describe('When burn tokens in a single tx', () => {
        it('should burn one token utxo successfully', async () => {
            await testBurnResult(await getTokenUtxos(cat20Generater, toReceiverAddr, 1));
        });

        it('should burn multiple token utxos successfully', async () => {
            await testBurnResult(await getTokenUtxos(cat20Generater, toReceiverAddr, 2));
        });
    });

    async function testBurnResult(cat20Utxos: CAT20Utxo[]) {
        const { guardTx, burnTx } = await burn(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            cat20Generater.deployInfo.minterAddr,
            cat20Utxos,
            await testChainProvider.getFeeRate(),
        );

        // check guard tx
        expect(guardTx).not.to.be.undefined;
        expect(guardTx.isFinalized).to.be.true;

        // check send tx
        expect(burnTx).not.to.be.undefined;
        expect(burnTx.isFinalized).to.be.true;

        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(bvmVerify(burnTx, i)).to.be.true;
        }

        // verify guard input unlock
        expect(bvmVerify(burnTx, cat20Utxos.length)).to.be.true;
    }
});
