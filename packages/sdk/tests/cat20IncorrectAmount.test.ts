import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import { loadAllArtifacts } from './features/cat20/utils';
import chaiAsPromised from 'chai-as-promised';
import { testSigner } from './utils/testSigner';
import { catToXOnly, getDummyUtxo, isP2TR, pubKeyPrefix } from '../src/lib/utils';
import {
    PubKey,
    ExtPsbt,
    getBackTraceInfo,
    fill,
    toByteString,
    STATE_OUTPUT_COUNT_MAX,
    uint8ArrayToHex,
    TX_INPUT_COUNT_MAX,
} from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Covenant } from '../src/covenants/cat20Covenant';
import { createCat20, TestCat20 } from './utils/testCAT20Generater';
import { CAT20, CAT20Guard, CAT20State, CAT20StateLib, Postage } from '../src';
import { CAT20GuardCovenant } from '../src/covenants/cat20GuardCovenant';
import { applyArray, getOutputSatoshisList } from './utils/txHelper';

use(chaiAsPromised);

describe('Test incorrect amount for cat20', () => {
    let mainAddress: string;
    let mainPubKey: {
        prefix: string;
        xOnlyPubKey: PubKey;
    };

    before(async () => {
        loadAllArtifacts();
        mainAddress = await testSigner.getAddress();
        mainPubKey = {
            prefix: isP2TR(mainAddress) ? '' : pubKeyPrefix(await testSigner.getPublicKey()),
            xOnlyPubKey: PubKey(catToXOnly(await testSigner.getPublicKey(), isP2TR(mainAddress))),
        };
    });

    it('should transfer, burn, and both when input amount is equal to output amount successfully', async () => {
        const cat20 = await createCat20([1000n], mainAddress, 'test');
        await testCase(cat20, [1000n], [0n]);
        await testCase(cat20, [], [1000n])
        await testCase(cat20, [500n], [500n]);
    });

    describe('When output amount is less than the input amount', async () => {
        it('should fail on transfer: input=1000, output=999, burn=0', async () => {
            const cat20 = await createCat20([1000n], mainAddress, 'test');
            return expect(testCase(cat20, [999n], [])).to.eventually.be.rejectedWith(
                'Failed to finalize input 1: Execution failed, Error: Execution failed',
            );
        });
        it('should fail on burn: input=1000, output=0, burn=999', async () => {
            const cat20 = await createCat20([1000n], mainAddress, 'test');
            return expect(testCase(cat20, [], [999n])).to.eventually.be.rejectedWith(
                'Failed to finalize input 1: Execution failed, Error: Execution failed',
            );
        });
        it('should fail on both transfer and burn: input=1000, output=500, burn=499', async () => {
            const cat20 = await createCat20([1000n], mainAddress, 'test');
            return expect(testCase(cat20, [500n], [499n])).to.eventually.be.rejectedWith(
                'Failed to finalize input 1: Execution failed, Error: Execution failed',
            );
        });
    });

    describe('When output amount is greater than the input amount', async () => {
        it('should fail on transfer: input=1000, output=1001, burn=0', async () => {
            const cat20 = await createCat20([1000n], mainAddress, 'test');
            return expect(testCase(cat20, [1001n], [])).to.eventually.be.rejectedWith(
                'Failed to finalize input 1: Execution failed, Error: Execution failed',
            );
        });
        it('should fail on burn: input=1000, output=0, burn=1001', async () => {
            const cat20 = await createCat20([1000n], mainAddress, 'test');
            return expect(testCase(cat20, [], [1001n])).to.eventually.be.rejectedWith(
                'Failed to finalize input 1: Execution failed, Error: Execution failed',
            );
        });
        it('should fail on both transfer and burn: input=1000, output=500, burn=501', async () => {
            const cat20 = await createCat20([1000n], mainAddress, 'test');
            return expect(testCase(cat20, [500n], [501n])).to.eventually.be.rejectedWith(
                'Failed to finalize input 1: Execution failed, Error: Execution failed',
            );
        });
    });

    async function testCase(cat20: TestCat20, outputAmountList: bigint[], burnAmountList: bigint[]) {
        const guardState = CAT20Guard.createEmptyState();

        // only 1 type token
        guardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        guardState.tokenAmounts[0] = cat20.tracedUtxos.reduce((acc, utxo) => acc + utxo.token.state.amount, 0n);
        guardState.tokenBurnAmounts[0] = burnAmountList.reduce((acc, amount) => acc + amount, 0n);

        const outputStates: CAT20State[] = outputAmountList
            .filter((amount) => amount > 0n)
            .map((amount) => ({
                ownerAddr: cat20.tracedUtxos[0].token.state.ownerAddr,
                amount,
            }));
        cat20.tracedUtxos.forEach((utxo, i) => {
            guardState.inputStateHashes[i] = CAT20StateLib.stateHash(utxo.token.state);
            guardState.tokenScriptIndexes[i] = 0n;
        });

        const guardCovenant = new CAT20GuardCovenant(guardState);
        {
            const psbt = new ExtPsbt().spendUTXO(getDummyUtxo(mainAddress)).addCovenantOutput(guardCovenant, 1e8);
            const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const guardInputIndex = cat20.tracedUtxos.length;
        const psbt = new ExtPsbt({forceAddStateRootHashOutput: true});
        cat20.tracedUtxos.forEach((utxo, i) => {
            psbt.addCovenantInput(utxo.token);
            guardState.tokenScriptIndexes[i] = 0n;
        });
        psbt.addCovenantInput(guardCovenant);
        outputStates.forEach((state) => {
            psbt.addCovenantOutput(
                new CAT20Covenant(cat20.generater.deployInfo.minterAddr, state),
                Postage.TOKEN_POSTAGE,
            );
        });
        psbt.change(mainAddress, 0);

        const outputHasCat20 = outputStates.length > 0;

        cat20.tracedUtxos.forEach((utxo, inputIndex) => {
            psbt.updateCovenantInput(inputIndex, utxo.token, {
                invokeMethod: (contract: CAT20, curPsbt: ExtPsbt) => {
                    contract.unlock(
                        {
                            userPubKeyPrefix: mainPubKey.prefix,
                            userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                            userSig: curPsbt.getSig(inputIndex, { address: mainAddress }),
                            contractInputIndexVal: -1n,
                        },
                        guardState,
                        BigInt(guardInputIndex),
                        getBackTraceInfo(utxo.trace.prevTxHex, utxo.trace.prevPrevTxHex, utxo.trace.prevTxInput),
                    );
                },
            });
        });
        psbt.updateCovenantInput(guardInputIndex, guardCovenant, {
            invokeMethod: (contract: CAT20Guard, curPsbt: ExtPsbt) => {
                const cat20OutputStartIndex = 1;
                const cat20InputStartIndex = 0;
                const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                {
                    // exclude the state hash root output
                    const outputScripts = curPsbt.txOutputs
                        .slice(1)
                        .map((output) => toByteString(uint8ArrayToHex(output.script)));
                    applyArray(outputScripts, ownerAddrOrScripts, cat20OutputStartIndex - 1);
                    const cat20OwnerAddrs = outputStates.map((state) => state.ownerAddr);
                    applyArray(cat20OwnerAddrs, ownerAddrOrScripts, cat20OutputStartIndex - 1);
                }

                const outputTokens = fill(0n, STATE_OUTPUT_COUNT_MAX);
                {
                    const cat20OutputAmounts = outputStates.map((state) => state.amount);
                    if (outputHasCat20) {
                        applyArray(cat20OutputAmounts, outputTokens, cat20OutputStartIndex - 1);
                    }
                }

                const tokenScriptIndexes = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                {
                    const cat20ScriptOutputIndexes = outputStates.map(() => 0n);
                    if (outputHasCat20) {
                        applyArray(cat20ScriptOutputIndexes, tokenScriptIndexes, cat20OutputStartIndex - 1);
                    }
                }

                const outputSatoshis = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                {
                    applyArray(getOutputSatoshisList(psbt).slice(1), outputSatoshis, 0);
                }
                const cat20States = fill({ ownerAddr: toByteString(''), amount: 0n }, TX_INPUT_COUNT_MAX);
                {
                    const inputCat20States = cat20.tracedUtxos.map((utxo) => utxo.token.state);
                    applyArray(inputCat20States, cat20States, cat20InputStartIndex);
                }
                // const outputCount = outputHasCat20 ? curPsbt.txOutputs.length - 1 : curPsbt.txOutputs.length; 
                const outputCount = curPsbt.txOutputs.length - 1; // exclude the state hash root output
                contract.unlock(
                    ownerAddrOrScripts,
                    outputTokens,
                    tokenScriptIndexes,
                    outputSatoshis,
                    cat20States,
                    BigInt(outputCount),
                );
            },
        });
        const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        expect(psbt.isFinalized).to.be.true;
    }
});
