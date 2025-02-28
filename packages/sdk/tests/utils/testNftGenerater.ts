import {
    Cat721NftInfo,
    CatPsbt,
    NftClosedMinterState,
    NftClosedMinterCat721Meta,
    StatefulCovenantUtxo,
    bitcoinjs,
    toTokenAddress,
    Cat721ClosedMinterUtxo,
} from '../../src/index';
import { deploy } from './testNft/features/deploy';
import { mint } from './testNft/features/mint';
import { testSigner } from './testSigner';
import { testChainProvider, testUtxoProvider } from './testProvider';
import { Ripemd160 } from 'scrypt-ts';

export const FEE_RATE = 10;

export interface Cat721MinterUtxoLocal extends StatefulCovenantUtxo {
    state: NftClosedMinterState;
}

export class TestNftGenerater {
    deployInfo: Cat721NftInfo<NftClosedMinterCat721Meta> & {
        genesisTx: bitcoinjs.Psbt;
        revealTx: CatPsbt;
    };
    minterTx: CatPsbt;
    minterUtxo: Cat721ClosedMinterUtxo;

    constructor(
        deployInfo: Cat721NftInfo<NftClosedMinterCat721Meta> & {
            genesisTx: bitcoinjs.Psbt;
            revealTx: CatPsbt;
            minterUtxo: Cat721ClosedMinterUtxo;
        },
    ) {
        this.deployInfo = deployInfo;
        this.minterTx = deployInfo.revealTx;
        this.minterUtxo = deployInfo.minterUtxo;
    }

    static async init(info: NftClosedMinterCat721Meta) {
        const deployInfo = await deploy(testSigner, testUtxoProvider, testChainProvider, info, FEE_RATE);
        return new TestNftGenerater(deployInfo);
    }

    private getCat721MinterUtxo() {
        return this.minterUtxo;
    }

    async mintNftToAddr(addr: string) {
        const tokenReceiverAddr = toTokenAddress(addr);
        const { cat721Utxo, minterUtxo } = await await mint(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            this.getCat721MinterUtxo() as unknown as Cat721ClosedMinterUtxo,
            this.deployInfo.collectionId,
            tokenReceiverAddr,
            await testSigner.getAddress(),
            FEE_RATE,
        );
        this.minterUtxo = minterUtxo;
        return cat721Utxo;
    }

    async mintNftToHash160(hash: string) {
        const { cat721Utxo, minterUtxo } = await await mint(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            this.getCat721MinterUtxo() as unknown as Cat721ClosedMinterUtxo,
            this.deployInfo.collectionId,
            Ripemd160(hash),
            await testSigner.getAddress(),
            FEE_RATE,
        );
        this.minterUtxo = minterUtxo;
        return cat721Utxo;
    }
}
