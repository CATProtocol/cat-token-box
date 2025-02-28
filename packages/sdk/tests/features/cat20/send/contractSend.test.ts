import * as dotenv from 'dotenv';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { hash160, Ripemd160 } from 'scrypt-ts';
import { OpenMinterCat20Meta } from '../../../../src/lib/metadata';
import { verifyInputSpent } from '../../../utils/txHelper';
import { CAT20 } from '../../../../src/contracts/token/cat20';
import { testSigner } from '../../../utils/testSigner';
import { Guard } from '../../../../src/contracts/token/guard';
import { contractSendToken } from '../openMinter.utils';
import { CAT20Proto } from '../../../../src/contracts/token/cat20Proto';
import { CAT20Covenant } from '../../../../src/covenants/cat20Covenant';
import { Cat20Utxo } from '../../../../src/lib/provider';
import { OpenMinterCovenant } from '../../../../src/covenants/openMinterCovenant';
import { toTokenAddress } from '../../../../src/lib/utils';
import { int32 } from '../../../../src/contracts/types';
import { TestTokenGenerater } from '../../../utils/testTokenGenerater';
import { ClosedMinter } from '../../../../src';

use(chaiAsPromised);

describe('Test the feature `contractSend` for `Cat20Covenant`', () => {
    let address: string;
    let contractScript: Ripemd160;
    let contractHash: Ripemd160;
    let tokenChangeAddr: Ripemd160;
    let tokenGenerater: TestTokenGenerater;
    let metadata: OpenMinterCat20Meta;

    before(async () => {
        await ClosedMinter.loadArtifact();
        await CAT20.loadArtifact();
        await Guard.loadArtifact();
        address = await testSigner.getAddress();
        contractScript = toTokenAddress(address);
        contractHash = hash160(contractScript);

        tokenChangeAddr = toTokenAddress(address);

        metadata = {
            name: 'c',
            symbol: 'C',
            decimals: 2,
            max: 21000000n,
            limit: 1000n,
            premine: 3150000n,
            preminerAddr: toTokenAddress(address),
            minterMd5: OpenMinterCovenant.LOCKED_ASM_VERSION,
        };
        tokenGenerater = await TestTokenGenerater.init(metadata);
    });

    const getTokenUtxos = async function (generater: TestTokenGenerater, contractHash: string, n: number) {
        const r: Cat20Utxo[] = [];
        for (let index = 0; index < n; index++) {
            const utxo = await generater.mintTokenToHash160(contractHash, BigInt(Math.floor(Math.random() * 1000000)));
            r.push(utxo);
        }
        return r;
    };

    describe('When sending tokens in a single tx', () => {
        it('should contract send one token utxo successfully', async () => {
            const tokenUtxos = await getTokenUtxos(tokenGenerater, contractHash, 1);
            const total = tokenUtxos.reduce((p, c) => p + c.state.amount, 0n);
            const toReceiverAmount = total / 2n;
            await testContractSendResult(tokenUtxos, toReceiverAmount, total - toReceiverAmount);
        });

        it('should contract send multiple token utxos successfully', async () => {
            const tokenUtxos = await getTokenUtxos(tokenGenerater, contractHash, 3);
            const total = tokenUtxos.reduce((p, c) => p + c.state.amount, 0n);
            const toReceiverAmount = total / 2n;
            await testContractSendResult(tokenUtxos, toReceiverAmount, total - toReceiverAmount);
        });
    });

    async function testContractSendResult(cat20Utxos: Cat20Utxo[], toReceiverAmount: int32, tokenChangeAmount?: int32) {
        const { guardTx, sendTx } = await contractSendToken(
            tokenGenerater.deployInfo.minterAddr,
            toReceiverAmount,
            cat20Utxos,
            contractHash,
        );

        // check guard tx
        expect(guardTx).not.to.be.undefined;
        expect(guardTx.isFinalized).to.be.true;

        // check send tx
        expect(sendTx).not.to.be.undefined;
        expect(sendTx.isFinalized).to.be.true;

        // verify token input unlock
        for (let i = 0; i < cat20Utxos.length; i++) {
            expect(verifyInputSpent(sendTx, i)).to.be.true;
        }

        // verify guard input unlock
        expect(verifyInputSpent(sendTx, cat20Utxos.length)).to.be.true;

        // verify token to receiver
        const toReceiverOutputIndex = 1;
        const toReceiverToken = new CAT20Covenant(
            tokenGenerater.deployInfo.minterAddr,
            CAT20Proto.create(toReceiverAmount, contractHash),
        );
        expect(Buffer.from(sendTx.txOutputs[toReceiverOutputIndex].script).toString('hex')).to.eq(
            toReceiverToken.lockingScript.toHex(),
        );
        expect(sendTx.txState.stateHashList[toReceiverOutputIndex - 1]).to.eq(toReceiverToken.stateHash);

        // verify token change
        if (tokenChangeAmount && tokenChangeAmount > 0) {
            const tokenChangeOutputIndex = 2;
            const tokenChange = new CAT20Covenant(
                tokenGenerater.deployInfo.minterAddr,
                CAT20Proto.create(tokenChangeAmount, tokenChangeAddr),
            );
            expect(Buffer.from(sendTx.txOutputs[tokenChangeOutputIndex].script).toString('hex')).to.eq(
                tokenChange.lockingScript.toHex(),
            );
            expect(sendTx.txState.stateHashList[tokenChangeOutputIndex - 1]).to.eq(tokenChange.stateHash);
        }
    }
});
