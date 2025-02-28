import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { PushTx } from '../../../src/contracts/pushTx/pushTx';
import { pushTxUnlock } from '../../../src/features/pushTx/pushTx';
import { testSigner } from '../../utils/testSigner';
import { testChainProvider, testUtxoProvider } from '../../utils/testProvider';
import { verifyInputSpent } from '../../utils/txHelper';

use(chaiAsPromised);

describe('Test the feature `push` for `PushTxCovenant`', () => {
    const repeat = 75;
    before(async () => {
        await PushTx.loadArtifact();
    });

    describe('When pushTx unlock', () => {
        it(`should repeat ${repeat} * 4 successfully`, async () => {
            for (let index = 0; index < repeat; index++) {
                for (let index = 0; index < 4; index++) {
                    await testPushTxResult(index + 1);
                }
            }
        });
    });

    async function testPushTxResult(pushTxCovenantInputNumber: number) {
        const { pushTxUnlockPsbt } = await pushTxUnlock(
            testSigner,
            testUtxoProvider,
            testChainProvider,
            pushTxCovenantInputNumber,
            1,
        );
        for (let index = 0; index < pushTxCovenantInputNumber; index++) {
            expect(verifyInputSpent(pushTxUnlockPsbt, index)).to.be.true;
        }
    }
});
