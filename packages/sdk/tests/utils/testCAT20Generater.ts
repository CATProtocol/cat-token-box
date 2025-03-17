import {
    bvmVerify,
    ByteString,
    ExtPsbt,
    Int32,
    StatefulCovenantUtxo,
    uint8ArrayToHex,
} from '@scrypt-inc/scrypt-ts-btc';
import {
    addrToP2trLockingScript,
    CAT20ClosedMinterState,
    Cat20TokenInfo,
    ClosedMinterCat20Meta,
    Postage,
    toTokenAddress,
} from '../../src';
import { deploy } from './testCAT20/features/deploy';
import { testSigner } from './testSigner';
import { testChainProvider, testUtxoProvider } from './testProvider';
import { mint } from './testCAT20/features/mint';
import { singleSend } from '../../src/features/cat20/send/singleSend';

export interface CAT20ClosedMinterUtxo extends StatefulCovenantUtxo {
    state: CAT20ClosedMinterState;
}

export class TestCAT20Generater {
    deployInfo: Cat20TokenInfo<ClosedMinterCat20Meta> & {
        genesisTx: ExtPsbt;
        revealTx: ExtPsbt;
    };
    minterTx: ExtPsbt;

    constructor(
        deployInfo: Cat20TokenInfo<ClosedMinterCat20Meta> & {
            genesisTx: ExtPsbt;
            revealTx: ExtPsbt;
        },
    ) {
        this.deployInfo = deployInfo;
        this.minterTx = deployInfo.revealTx;
    }

    static async init(info: ClosedMinterCat20Meta) {
        const deployInfo = await deploy(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            info,
            await testChainProvider.getFeeRate(),
        );
        return new TestCAT20Generater(deployInfo);
    }

    private getCat20MinterUtxo() {
        const cat20MinterUtxo: CAT20ClosedMinterUtxo = {
            txId: this.minterTx.extractTransaction().getId(),
            outputIndex: 1,
            script: addrToP2trLockingScript(this.deployInfo.minterAddr),
            satoshis: Postage.MINTER_POSTAGE,
            txHashPreimage: uint8ArrayToHex(this.minterTx.extractTransaction().toBuffer(undefined, 0, false)),
            txoStateHashes: this.minterTx.getTxoStateHashes(),
            state: {
                tokenScript: addrToP2trLockingScript(this.deployInfo.tokenAddr),
            },
        };
        return cat20MinterUtxo;
    }

    async mintThenTransfer(addr: ByteString, amount: Int32) {
        const signerAddr = await testSigner.getAddress();
        const signerTokenAddr = toTokenAddress(signerAddr);
        const mintInfo = await mint(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            this.getCat20MinterUtxo(),
            this.deployInfo.tokenId,
            signerTokenAddr,
            amount,
            await testSigner.getAddress(),
            await testChainProvider.getFeeRate(),
        );
        for (let index = 0; index < mintInfo.mintTx.inputCount; index++) {
            bvmVerify(mintInfo.mintTx, index);
        }
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
            await testChainProvider.getFeeRate(),
        );
        return transferInfo.newCAT20Utxos[0];
    }

    async mintTokenToAddr(addr: string, amount: Int32) {
        const tokenReceiverAddr = toTokenAddress(addr);
        return this.mintThenTransfer(tokenReceiverAddr, amount);
    }

    async mintTokenToHash160(hash: string, amount: Int32) {
        return this.mintThenTransfer(hash, amount);
    }
}
