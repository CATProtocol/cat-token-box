import { ByteString, ExtPsbt, Ripemd160, StatefulCovenantUtxo } from '@scrypt-inc/scrypt-ts-btc';
import { Cat721NftInfo, ClosedMinterCat721Meta, toTokenAddress } from '../../src';
import { CAT721ClosedMinterState } from '../../src/contracts/cat721/types';
import { testSigner } from './testSigner';
import { testChainProvider, testUtxoProvider } from './testProvider';
import { deploy } from './testCAT721/features/deploy';
import { mint } from './testCAT721/features/mint';
import { singleSendNft } from '../../src/features/cat721/send/singleSend';
import { CAT721Utxo } from '../../src/lib/provider';
import { CAT721Covenant, TracedCAT721Nft } from '../../src/covenants/cat721Covenant';

export interface CAT721ClosedMinterUtxo extends StatefulCovenantUtxo {
    state: CAT721ClosedMinterState;
}

export class TestCAT721Generater {
    deployInfo: Cat721NftInfo<ClosedMinterCat721Meta> & {
        genesisTx: ExtPsbt;
        revealTx: ExtPsbt;
    };
    minterTx: ExtPsbt;
    minterUtxo: CAT721ClosedMinterUtxo;

    constructor(
        deployInfo: Cat721NftInfo<ClosedMinterCat721Meta> & {
            genesisTx: ExtPsbt;
            revealTx: ExtPsbt;
            minterUtxo: CAT721ClosedMinterUtxo;
        },
    ) {
        this.deployInfo = deployInfo;
        this.minterTx = deployInfo.revealTx;
        this.minterUtxo = deployInfo.minterUtxo;
    }

    static async init(info: ClosedMinterCat721Meta) {
        const deployInfo = await deploy(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            info,
            await testChainProvider.getFeeRate(),
        );
        return new TestCAT721Generater(deployInfo);
    }

    async mintThenTransfer(addr: ByteString) {
        const signerAddr = await testSigner.getAddress();
        const signerTokenAddr = toTokenAddress(signerAddr);
        const mintInfo = await mint(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            this.minterUtxo,
            this.deployInfo.collectionId,
            this.deployInfo.metadata.max,
            signerTokenAddr,
            await testSigner.getAddress(),
            await testChainProvider.getFeeRate(),
        );
        const transferInfo = await singleSendNft(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            this.deployInfo.minterAddr,
            [mintInfo.cat721Utxo],
            [Ripemd160(addr)],
            await testChainProvider.getFeeRate(),
        );
        this.minterTx = mintInfo.mintTx
        this.minterUtxo = mintInfo.minterUtxo
        return transferInfo.newCAT721Utxos[0];
    }

    async mintNFtToAddr(addr: string) {
        const tokenReceiverAddr = toTokenAddress(addr);
        return this.mintThenTransfer(tokenReceiverAddr);
    }

    async mintNftToHash160(hash: string) {
        return this.mintThenTransfer(hash);
    }
}




export type TestCat721 = {
    generater: TestCAT721Generater;
    tracedUtxos: TracedCAT721Nft[];
}
export async function createCat721(symbol: string, nftCount: number, toAddress: string): Promise<TestCat721> {
    const metadata = {
        name: `cat721_${symbol}`,
        symbol: `cat721_${symbol}`,
        max: 10000n,
        minterMd5: '',
        description: '',
    }
    const cat721Generater = await TestCAT721Generater.init(metadata);
    
    const utxos: CAT721Utxo[] = []
    for (let i = 0; i < nftCount; i++) {
        const utxo = await cat721Generater.mintNFtToAddr(toAddress);
        utxos.push(utxo)
    }
    const tracedUtxos = await CAT721Covenant.backtrace(utxos.map(utxo => {
        return {
            minterAddr: cat721Generater.deployInfo.minterAddr,
            ...utxo,
        }
    }), testChainProvider)
    return {
        generater: cat721Generater,
        tracedUtxos,
    }
}