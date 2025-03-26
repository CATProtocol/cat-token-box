import * as dotenv from 'dotenv';
dotenv.config();

import { bvmVerify } from "@scrypt-inc/scrypt-ts-btc";
import { singleSend } from "../src/features/cat20";
import { createCat20 } from "./utils/testCAT20Generater";
import { testChainProvider, testUtxoProvider } from "./utils/testProvider";
import { testSigner } from "./utils/testSigner";

import { expect, use } from "chai";  
import chaiAsPromised from "chai-as-promised";
import { loadAllArtifacts } from './features/cat20/utils';

use(chaiAsPromised);

describe('Test for cat20 overflow', async () => {

    const INIT32_MAX = 2147483647n;

    let mainAddress: string;

    before(async () => {
        loadAllArtifacts()
        mainAddress = await testSigner.getAddress()
    })

    it('should be success when a type of cat20\'s sum input amount is not exceed the int32 max', async () => {
        const totalSum = INIT32_MAX
        const cat20 = await createCat20([totalSum - 1n, 1n], mainAddress, 'test')
        const receivers = [{
            address: mainAddress,
            amount: totalSum - 1n,
        }, {
            address: mainAddress,
            amount: 1n,
        }]

        // success on both transaction and bvm verify
        const {sendTx} = await singleSend(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            cat20.generater.deployInfo.minterAddr,
            cat20.tracedUtxos.map(v => {
                return {
                    ...v.token.utxo!,
                    state: v.token.state,
                }
            }),
            receivers,
            mainAddress,
            await testChainProvider.getFeeRate(),
        )
        expect(bvmVerify(sendTx, 2)).to.be.true;
    })

    it('should be failed when a type of cat20\'s sum input amount is exceed the int32 max', async  () => {
        const totalSum = INIT32_MAX + 1n;
        const cat20 = await createCat20([totalSum - 2n, 2n], mainAddress, 'test')
        const receivers = [{
            address: mainAddress,
            amount: totalSum - 2n,
        }, {
            address: mainAddress,
            amount: 2n,
        }]

        // success on transaction, but failed on bvm verify
        const {sendTx} = await singleSend(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            cat20.generater.deployInfo.minterAddr,
            cat20.tracedUtxos.map(v => {
                return {
                    ...v.token.utxo!,
                    state: v.token.state,
                }
            }),
            receivers,
            mainAddress,
            await testChainProvider.getFeeRate(),
        )
        expect(bvmVerify(sendTx, 2)).equals('SCRIPT_ERR_UNKNOWN_ERROR')
    })
})

