import {
    Cat20MinterUtxo,
    Cat20TokenInfo,
    CatPsbt,
    ClosedMinterCat20Meta,
    ClosedMinterState,
    Postage,
    StatefulCovenantUtxo,
    addrToP2trLockingScript,
    bitcoinjs,
    int32,
    toTokenAddress,
} from '../../src/index';
import { deploy } from './testToken/features/deploy';
import { singleSend } from '../../src/features/cat20/send/singleSend';
import { testSigner } from './testSigner';
import { testChainProvider, testUtxoProvider } from './testProvider';
import { mint } from './testToken/features/mint';
import { ByteString } from 'scrypt-ts';

export const FEE_RATE = 10;

export interface Cat20MinterUtxoLocal extends StatefulCovenantUtxo {
    state: ClosedMinterState;
}

export class TestTokenGenerater {
    deployInfo: Cat20TokenInfo<ClosedMinterCat20Meta> & {
        genesisTx: bitcoinjs.Psbt;
        revealTx: CatPsbt;
    };
    minterTx: CatPsbt;

    constructor(
        deployInfo: Cat20TokenInfo<ClosedMinterCat20Meta> & {
            genesisTx: bitcoinjs.Psbt;
            revealTx: CatPsbt;
        },
    ) {
        this.deployInfo = deployInfo;
        this.minterTx = deployInfo.revealTx;
    }

    static async init(info: ClosedMinterCat20Meta) {
        const deployInfo = await deploy(testSigner, testUtxoProvider, testChainProvider, info, FEE_RATE);
        return new TestTokenGenerater(deployInfo);
    }

    private getCat20MinterUtxo() {
        const cat20MinterUtxo: Cat20MinterUtxoLocal = {
            utxo: {
                txId: this.minterTx.extractTransaction().getId(),
                outputIndex: 1,
                script: addrToP2trLockingScript(this.deployInfo.minterAddr),
                satoshis: Postage.MINTER_POSTAGE,
            },
            txoStateHashes: this.minterTx.getTxStatesInfo().stateHashes,
            state: {
                tokenScript: addrToP2trLockingScript(this.deployInfo.tokenAddr),
            },
        };
        return cat20MinterUtxo;
    }

    async mintThenTransfer(addr: ByteString, amount: int32) {
        const signerAddr = await testSigner.getAddress();
        const signerTokenAddr = toTokenAddress(signerAddr);
        const mintInfo = await mint(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            this.getCat20MinterUtxo() as unknown as Cat20MinterUtxo,
            this.deployInfo.tokenId,
            signerTokenAddr,
            amount,
            await testSigner.getAddress(),
            FEE_RATE,
        );

        const transferInfo = await singleSend(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            this.deployInfo.minterAddr,
            [mintInfo.cat20Utxo],
            [
                {
                    address: addr,
                    amount,
                },
            ],
            signerAddr,
            FEE_RATE,
        );
        return transferInfo.newCat20Utxos[0];
    }

    async mintTokenToAddr(addr: string, amount: int32) {
        const tokenReceiverAddr = toTokenAddress(addr);
        return this.mintThenTransfer(tokenReceiverAddr, amount);
    }

    async mintTokenToHash160(hash: string, amount: int32) {
        return this.mintThenTransfer(hash, amount);
    }
}
