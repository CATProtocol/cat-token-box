import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { TestCAT721Generater } from '../../../utils/testCAT721Generater';
import { NftParallelClosedMinterCat721Meta } from 'packages/sdk/src';
import { loadAllArtifacts } from '../utils';
import { testErrorSigner } from '../../../utils/testSigner';
import { CAT721Utxo } from '../../../../src/lib/provider';
import { singleSendNft } from '../../../../src/features/cat721/send/singleSend';
import { testChainProvider, testUtxoProvider } from '../../../utils/testProvider';
import { bvmVerify, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import { CAT721Covenant } from '../../../../src/covenants/cat721Covenant';

use(chaiAsPromised);

describe('Test the feature `send` for `CAT721Covenant`', () => {
    let address: string;
    let nftGenerater: TestCAT721Generater;
    let metadata: NftParallelClosedMinterCat721Meta;

    before(async () => {
        loadAllArtifacts();
        address = await testErrorSigner.getAddress();

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

    describe('When sending nfts in a single tx', () => {
        it('should failed send one token use incorrect signer', async () => {
            const nftUtxos = await getNftUtxos(nftGenerater, address, 1);
            return expect(testSendResult(nftUtxos)).to.eventually.be.rejectedWith('signature check failed');
        });

        it('should failed send multiple nft utxos use incorrect signer', async () => {
            const nftUtxos = await getNftUtxos(nftGenerater, address, 3);
            return expect(testSendResult(nftUtxos)).to.eventually.be.rejectedWith('signature check failed');
        });
    });

    async function testSendResult(cat721Utxos: CAT721Utxo[]) {
        const { guardTx, sendTx } = await singleSendNft(
            testErrorSigner,
            testUtxoProvider,
            testChainProvider,
            nftGenerater.deployInfo.minterAddr,
            cat721Utxos,
            cat721Utxos.map((v) => Ripemd160(v.state.ownerAddr)),
            await testChainProvider.getFeeRate(),
        );

        // check guard tx
        expect(guardTx).not.to.be.undefined;
        expect(guardTx.isFinalized).to.be.true;

        // check send tx
        expect(sendTx).not.to.be.undefined;
        expect(sendTx.isFinalized).to.be.true;

        // verify token input unlock
        for (let i = 0; i < cat721Utxos.length; i++) {
            expect(bvmVerify(sendTx, i)).to.be.true;
        }

        // verify guard input unlock
        expect(bvmVerify(sendTx, cat721Utxos.length)).to.be.true;

        // verify nft to receiver
        const toReceiverOutputIndex = 1;
        const toReceiverToken = new CAT721Covenant(nftGenerater.deployInfo.minterAddr, {
            localId: cat721Utxos[0].state.localId,
            ownerAddr: cat721Utxos[0].state.ownerAddr,
        });
        expect(Buffer.from(sendTx.txOutputs[toReceiverOutputIndex].script).toString('hex')).to.eq(
            toReceiverToken.lockingScript.toHex(),
        );
        expect(sendTx.getTxoStateHashes()[toReceiverOutputIndex - 1]).to.eq(toReceiverToken.stateHash);
    }
});
