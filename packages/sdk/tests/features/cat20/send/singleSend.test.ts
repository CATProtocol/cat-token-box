import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { bvmVerify, Int32, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Covenant, OpenMinterCat20Meta, toTokenAddress } from '../../../../src';
import { loadAllArtifacts, singleSendToken } from '../utils';
import { testSigner } from '../../../../tests/utils/testSigner';
import { TestCAT20Generater } from '../../../../tests/utils/testCAT20Generater';
import { CAT20Utxo } from '../../../../src/lib/provider';

use(chaiAsPromised);

describe('Test the feature `send` for `Cat20Covenant`', () => {
    let address: string;
    let toReceiverAddr: Ripemd160;
    let tokenChangeAddr: Ripemd160;

    let metadata: OpenMinterCat20Meta;
    let cat20Generater: TestCAT20Generater;

    before(async () => {
        loadAllArtifacts();
        address = await testSigner.getAddress();
        toReceiverAddr = Ripemd160(toTokenAddress(address));
        tokenChangeAddr = Ripemd160(toTokenAddress(address));

        metadata = {
            name: 'c',
            symbol: 'C',
            decimals: 2,
            max: 21000000n,
            limit: 1000n,
            premine: 3150000n,
            preminerAddr: Ripemd160(toTokenAddress(address)),
            minterMd5: '',
        };
        cat20Generater = await TestCAT20Generater.init(metadata);
    });

    const getTokenUtxos = async function (generater: TestCAT20Generater, address: string, n: number) {
        const r: CAT20Utxo[] = [];
        for (let index = 0; index < n; index++) {
            const utxo = await generater.mintTokenToAddr(address, BigInt(Math.floor(Math.random() * 1000000)));
            r.push(utxo);
        }
        return r;
    };

    describe('When sending tokens in a single tx', () => {
        it('should send one token utxo successfully', async () => {
            const toReceiverAmount = BigInt(metadata.decimals);
            const tokenUtxos = await getTokenUtxos(cat20Generater, address, 1);
            const total = tokenUtxos.reduce((acc, cur) => acc + cur.state.amount, BigInt(0));
            await testSendResult(tokenUtxos, toReceiverAmount, total - toReceiverAmount);
        });

        it('should send multiple token utxos successfully', async () => {
            const toReceiverAmount = BigInt(metadata.decimals);
            const tokenUtxos = await getTokenUtxos(cat20Generater, address, 3);
            const total = tokenUtxos.reduce((acc, cur) => acc + cur.state.amount, BigInt(0));
            await testSendResult(tokenUtxos, toReceiverAmount, total - toReceiverAmount);
        });
    });

    async function testSendResult(cat20Utxos: CAT20Utxo[], toReceiverAmount: Int32, tokenChangeAmount?: Int32) {
        const { guardTx, sendTx } = await singleSendToken(
            cat20Generater.deployInfo.minterAddr,
            toReceiverAmount,
            cat20Utxos,
            toReceiverAddr,
        );

        // check guard tx
        expect(guardTx).not.to.be.undefined;
        expect(guardTx.isFinalized).to.be.true;

        // check send tx
        expect(sendTx).not.to.be.undefined;
        expect(sendTx.isFinalized).to.be.true;

        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(bvmVerify(sendTx, i)).to.be.true;
        }

        // verify guard input unlock
        expect(bvmVerify(sendTx, cat20Utxos.length)).to.be.true;

        // verify token to receiver
        const toReceiverOutputIndex = 1;
        const toReceiverToken = new CAT20Covenant(cat20Generater.deployInfo.minterAddr, {
            amount: toReceiverAmount,
            ownerAddr: toReceiverAddr,
        });
        expect(Buffer.from(sendTx.txOutputs[toReceiverOutputIndex].script).toString('hex')).to.eq(
            toReceiverToken.lockingScript.toHex(),
        );
        expect(sendTx.getTxoStateHashes()[toReceiverOutputIndex - 1]).to.eq(toReceiverToken.stateHash);

        // verify token change
        if (tokenChangeAmount && tokenChangeAmount > 0) {
            const tokenChangeOutputIndex = 2;
            const tokenChange = new CAT20Covenant(cat20Generater.deployInfo.minterAddr, {
                amount: tokenChangeAmount,
                ownerAddr: tokenChangeAddr,
            });
            expect(Buffer.from(sendTx.txOutputs[tokenChangeOutputIndex].script).toString('hex')).to.eq(
                tokenChange.lockingScript.toHex(),
            );
            expect(sendTx.getTxoStateHashes()[tokenChangeOutputIndex - 1]).to.eq(tokenChange.stateHash);
        }
    }
});
