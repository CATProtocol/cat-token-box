import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { hash160, Ripemd160 } from 'scrypt-ts';
import { NftParallelClosedMinterCat721Meta } from '../../../../src/lib/metadata';
import { verifyInputSpent } from '../../../utils/txHelper';
import { CAT721 } from '../../../../src/contracts/nft/cat721';
import { NftGuard } from '../../../../src/contracts/nft/nftGuard';
import { testSigner } from '../../../utils/testSigner';
import { contractSendNft } from '../nftParallelClosedMinter.utils';
import { CAT721Proto } from '../../../../src/contracts/nft/cat721Proto';
import { CAT721Covenant } from '../../../../src/covenants/cat721Covenant';
import { Cat721Utxo } from '../../../../src/lib/provider';
import { toTokenAddress } from '../../../../src/lib/utils';
import { NftParallelClosedMinter, NftParallelClosedMinterCovenant } from '../../../../src';
import { TestNftGenerater } from '../../../utils/testNftGenerater';

use(chaiAsPromised);

describe('Test the feature `contractSend` for `Cat721Covenant`', () => {
    let address: string;
    let contractScript: Ripemd160;
    let contractHash: Ripemd160;
    let nftGenerater: TestNftGenerater;
    let metadata: NftParallelClosedMinterCat721Meta;

    before(async () => {
        await NftParallelClosedMinter.loadArtifact();
        await CAT721.loadArtifact();
        await NftGuard.loadArtifact();
        address = await testSigner.getAddress();
        contractScript = toTokenAddress(address);
        contractHash = hash160(contractScript);

        metadata = {
            name: 'Locked-up Cats',
            symbol: 'LCAT',
            max: 10000n,
            minterMd5: NftParallelClosedMinterCovenant.LOCKED_ASM_VERSION,
            description:
                'It’s the first NFT collection distributed on the Bitcoin Network based on the brand new CAT721 protocol.',
        };
        nftGenerater = await TestNftGenerater.init(metadata);
    });

    const getNftUtxos = async function (generater: TestNftGenerater, contractHash: string, n: number) {
        const r: Cat721Utxo[] = [];
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

    async function testContractSendResult(cat721Utxos: Cat721Utxo[]) {
        const { guardTx, sendTx } = await contractSendNft(
            nftGenerater.deployInfo.minterAddr,
            cat721Utxos,
            cat721Utxos.map(() => contractHash),
        );

        // check guard tx
        expect(guardTx).not.to.be.undefined;
        expect(guardTx.isFinalized).to.be.true;

        // check send tx
        expect(sendTx).not.to.be.undefined;
        expect(sendTx.isFinalized).to.be.true;

        // verify token input unlock
        for (let i = 0; i < cat721Utxos.length; i++) {
            expect(verifyInputSpent(sendTx, i)).to.be.true;
        }

        // verify guard input unlock
        expect(verifyInputSpent(sendTx, cat721Utxos.length)).to.be.true;

        // verify token to receiver
        for (let index = 0; index < cat721Utxos.length; index++) {
            const toReceiverOutputIndex = 1 + index;
            const toReceiverToken = new CAT721Covenant(
                nftGenerater.deployInfo.minterAddr,
                CAT721Proto.create(cat721Utxos[index].state.localId, contractHash),
            );
            expect(Buffer.from(sendTx.txOutputs[toReceiverOutputIndex].script).toString('hex')).to.eq(
                toReceiverToken.lockingScript.toHex(),
            );
            expect(sendTx.txState.stateHashList[toReceiverOutputIndex - 1]).to.eq(toReceiverToken.stateHash);
        }
    }
});
