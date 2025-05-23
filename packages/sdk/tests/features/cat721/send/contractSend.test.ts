import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { bvmVerify, hash160, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import { TestCAT721Generater } from '../../../utils/testCAT721Generater';
import { NftParallelClosedMinterCat721Meta, toTokenAddress, CAT721Utxo, CAT721Covenant, contractSendNft } from '@cat-protocol/cat-sdk-v2';
import { loadAllArtifacts } from '../utils';
import { testSigner } from '../../../utils/testSigner';
import { testChainProvider, testUtxoProvider } from '../../../utils/testProvider';
use(chaiAsPromised);

describe('Test the feature `contractSend` for `Cat721Covenant`', () => {
    let contractHash: Ripemd160;
    let nftGenerater: TestCAT721Generater;
    let metadata: NftParallelClosedMinterCat721Meta;

    before(async () => {
        loadAllArtifacts();
        const address = await testSigner.getAddress();
        const contractScript = toTokenAddress(address);
        contractHash = hash160(contractScript);
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

    const getNftUtxos = async function (generater: TestCAT721Generater, contractHash: string, n: number) {
        const r: CAT721Utxo[] = [];
        for (let index = 0; index < n; index++) {
            const utxo = await generater.mintNftToHash160(contractHash);
            r.push(utxo);
        }
        return r;
    };

    describe('When sending nfts in a single tx', () => {
        it('should contract send one nft utxo successfully', async () => {
            const nftUtxos = await getNftUtxos(nftGenerater, contractHash, 1);
            await testContractSendResult(nftUtxos);
        });

        it('should contract send multiple nft utxos successfully', async () => {
            const nftUtxos = await getNftUtxos(nftGenerater, contractHash, 3);
            await testContractSendResult(nftUtxos);
        });
    });

    async function testContractSendResult(cat721Utxos: CAT721Utxo[]) {
        const { guardTx, sendTx } = await contractSendNft(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            nftGenerater.deployInfo.minterAddr,
            cat721Utxos,
            cat721Utxos.map(() => contractHash),
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

        // verify token to receiver
        for (let index = 0; index < cat721Utxos.length; index++) {
            const toReceiverOutputIndex = 1 + index;
            const toReceiverToken = new CAT721Covenant(nftGenerater.deployInfo.minterAddr, {
                localId: cat721Utxos[index].state.localId,
                ownerAddr: contractHash,
            });
            expect(Buffer.from(sendTx.txOutputs[toReceiverOutputIndex].script).toString('hex')).to.eq(
                toReceiverToken.lockingScript.toHex(),
            );
            expect(sendTx.getTxoStateHashes()[toReceiverOutputIndex - 1]).to.eq(toReceiverToken.stateHash);
        }
    }
});
