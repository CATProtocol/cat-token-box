import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { CAT20Utxo } from '../../../../src/lib/provider';
import { TestCAT20Generater } from '../../../utils/testCAT20Generater';
import { bvmVerify, hash160, Int32, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Covenant, OpenMinterCat20Meta, toTokenAddress } from '../../../../src';
import { testSigner } from '../../../utils/testSigner';
import { contractSend } from '../../../../src/features/cat20/send/contractSend';
import { testChainProvider, testUtxoProvider } from '../../../utils/testProvider';
import { loadAllArtifacts } from '../utils';

use(chaiAsPromised);

describe('Test the feature `contractSend` for `Cat20Covenant`', () => {
    let address: string;
    let contractScript: Ripemd160;
    let contractHash: Ripemd160;
    let cat20ChangeAddr: Ripemd160;
    let cat20Generater: TestCAT20Generater;
    let metadata: OpenMinterCat20Meta;

    before(async () => {
        loadAllArtifacts();
        // await CAT20ClosedMinter.loadArtifact(readArtifact('artifacts/cat20/minters/cat20ClosedMinter.json'));
        // await CAT20.loadArtifact(readArtifact('artifacts/cat20/cat20.json'));
        // await CAT20StateLib.loadArtifact(readArtifact('artifacts/cat20/cat20State.json'));
        // await CAT20Guard.loadArtifact(readArtifact('artifacts/cat20/cat20Guard.json'));
        // await CAT20GuardStateLib.loadArtifact(readArtifact('artifacts/cat20/cat20GuardState.json'));
        address = await testSigner.getAddress();
        contractScript = Ripemd160(toTokenAddress(address));
        contractHash = hash160(contractScript);
        cat20ChangeAddr = Ripemd160(toTokenAddress(address));

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

    const getTokenUtxos = async function (generater: TestCAT20Generater, contractHash: string, n: number) {
        const r: CAT20Utxo[] = [];
        for (let index = 0; index < n; index++) {
            const utxo = await generater.mintTokenToHash160(contractHash, BigInt(Math.floor(Math.random() * 1000000)));
            r.push(utxo);
        }
        return r;
    };

    describe('When sending tokens in a single tx', () => {
        it('should contract send one token utxo successfully', async () => {
            const tokenUtxos = await getTokenUtxos(cat20Generater, contractHash, 1);
            const total = tokenUtxos.reduce((p, c) => p + c.state.amount, 0n);
            const toReceiverAmount = total / 2n;
            await testContractSendResult(tokenUtxos, toReceiverAmount, total - toReceiverAmount);
        });

        it('should contract send multiple token utxos successfully', async () => {
            const tokenUtxos = await getTokenUtxos(cat20Generater, contractHash, 3);
            const total = tokenUtxos.reduce((p, c) => p + c.state.amount, 0n);
            const toReceiverAmount = total / 2n;
            await testContractSendResult(tokenUtxos, toReceiverAmount, total - toReceiverAmount);
        });
    });

    async function testContractSendResult(cat20Utxos: CAT20Utxo[], toReceiverAmount: Int32, tokenChangeAmount?: Int32) {
        const { guardTx, sendTx } = await contractSend(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            cat20Generater.deployInfo.minterAddr,
            cat20Utxos,
            [
                {
                    address: contractHash,
                    amount: toReceiverAmount,
                },
            ],
            cat20ChangeAddr,
            await testChainProvider.getFeeRate(),
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
            ownerAddr: contractHash,
            amount: toReceiverAmount,
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
                ownerAddr: cat20ChangeAddr,
            });
            expect(Buffer.from(sendTx.txOutputs[tokenChangeOutputIndex].script).toString('hex')).to.eq(
                tokenChange.lockingScript.toHex(),
            );
            expect(sendTx.getTxoStateHashes()[tokenChangeOutputIndex - 1]).to.eq(tokenChange.stateHash);
        }
    }
});
