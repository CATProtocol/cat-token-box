import {
    bvmVerify,
    ByteString,
    ExtPsbt,
    Int32,
    Ripemd160,
    StatefulCovenantUtxo,
    uint8ArrayToHex,
} from '@scrypt-inc/scrypt-ts-btc';
import {
    addrToP2trLockingScript,
    CAT20ClosedMinterState,
    CAT20Covenant,
    Cat20TokenInfo,
    ClosedMinterCat20Meta,
    Postage,
    toTokenAddress,
    TracedCAT20Token,
} from '../../src';
import { deploy } from './testCAT20/features/deploy';
import { testSigner } from './testSigner';
import { testChainProvider, testUtxoProvider } from './testProvider';
import { mint } from './testCAT20/features/mint';
import { singleSend } from '../../src/features/cat20/send/singleSend';
import { CAT20Utxo } from '../../src/lib/provider';

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

export type TestCat20 = {
    generater: TestCAT20Generater;
    tracedUtxos: TracedCAT20Token[];
};

export async function createCat20(amountList: bigint[], toAddress: string, symbol: string): Promise<TestCat20> {
    const metadata = {
        name: `cat20_${symbol}`,
        symbol: `cat20_${symbol}`,
        decimals: 2,
        max: 21000000n,
        limit: 1000n,
        premine: 3150000n,
        preminerAddr: Ripemd160(toTokenAddress(toAddress)),
        minterMd5: '',
    };
    const cat20Generater = await TestCAT20Generater.init(metadata);
    const utxoList: CAT20Utxo[] = [];
    for (let i = 0; i < amountList.length; i++) {
        const utxo = await cat20Generater.mintTokenToAddr(toAddress, amountList[i]);
        utxoList.push(utxo);
    }
    const tracedUtxos = await CAT20Covenant.backtrace(
        utxoList.map((v) => {
            return {
                minterAddr: cat20Generater.deployInfo.minterAddr,
                ...v,
            };
        }),
        testChainProvider,
    );

    return {
        generater: cat20Generater,
        tracedUtxos,
    };
}
