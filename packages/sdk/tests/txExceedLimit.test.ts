import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ExtPsbt, TX_INPUT_COUNT_MAX, STATE_OUTPUT_COUNT_MAX, TX_OUTPUT_COUNT_MAX } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Covenant, CAT20Guard, CAT20State, CAT20StateLib, CAT20GuardCovenant, Postage, CAT20 } from '../src';
import { loadAllArtifacts } from './features/cat20/utils';
import { testSigner } from './utils/testSigner';
import { createCat20, TestCat20 } from './utils/testCAT20Generater';
import { catToXOnly, getDummyUtxo, isP2TR, pubKeyPrefix } from '../src/lib/utils';
import { fill, getBackTraceInfo_, PubKey, toByteString } from '@scrypt-inc/scrypt-ts-btc';
import { applyArray, getOutputSatoshisList } from './utils/txHelper';

use(chaiAsPromised);

describe('Test ExtPsbt inputCount/outputCount exceed limit', () => {
    let mainAddress: string;
    let mainPubKey: {
        prefix: string;
        xOnlyPubKey: PubKey;
    };
    let cat20: TestCat20;

    before(async () => {
        loadAllArtifacts();
        mainAddress = await testSigner.getAddress();
        mainPubKey = {
            prefix: isP2TR(mainAddress) ? '' : pubKeyPrefix(await testSigner.getPublicKey()),
            xOnlyPubKey: PubKey(catToXOnly(await testSigner.getPublicKey(), isP2TR(mainAddress))),
        };
        cat20 = await createCat20([1000n], mainAddress, 'test');
    });

    it('should fail inputCount exceed limit', async () => {
        const guardState = CAT20Guard.createEmptyState();
        guardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        guardState.tokenAmounts[0] = cat20.tracedUtxos.reduce((acc, utxo) => acc + utxo.token.state.amount, 0n);
        guardState.tokenBurnAmounts[0] = 0n;

        cat20.tracedUtxos.forEach((utxo, i) => {
            guardState.inputStateHashes[i] = CAT20StateLib.stateHash(utxo.token.state);
            guardState.tokenScriptIndexes[i] = 0n;
        });

        const guardCovenant = new CAT20GuardCovenant(guardState);

        {
            const psbt = new ExtPsbt().spendUTXO(getDummyUtxo(mainAddress)).addCovenantOutput(guardCovenant, 1e8);
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const psbt = new ExtPsbt();

        cat20.tracedUtxos.forEach((utxo) => {
            psbt.addCovenantInput(utxo.token);
        });

        psbt.addCovenantInput(guardCovenant);

        const inputsToAdd = TX_INPUT_COUNT_MAX + 1 - psbt.txInputs.length;

        for (let i = 0; i < inputsToAdd; i++) {
            try {
                psbt.spendUTXO(getDummyUtxo(mainAddress));
            } catch (error) {
                expect(error.message).to.include('inputs which exceeds the limit of');
                return;
            }
        }

        expect.fail('Should have thrown an error for exceeding input count limit');
    });

    it('should fail outputCount exceed limit', async () => {
        const guardState = CAT20Guard.createEmptyState();
        guardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        guardState.tokenAmounts[0] = cat20.tracedUtxos.reduce((acc, utxo) => acc + utxo.token.state.amount, 0n);
        guardState.tokenBurnAmounts[0] = 0n;

        cat20.tracedUtxos.forEach((utxo, i) => {
            guardState.inputStateHashes[i] = CAT20StateLib.stateHash(utxo.token.state);
            guardState.tokenScriptIndexes[i] = 0n;
        });

        const guardCovenant = new CAT20GuardCovenant(guardState);

        {
            const psbt = new ExtPsbt().spendUTXO(getDummyUtxo(mainAddress)).addCovenantOutput(guardCovenant, 1e8);
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const psbt = new ExtPsbt();

        cat20.tracedUtxos.forEach((utxo) => {
            psbt.addCovenantInput(utxo.token);
        });
        psbt.addCovenantInput(guardCovenant);

        const outputState: CAT20State = {
            ownerAddr: cat20.tracedUtxos[0].token.state.ownerAddr,
            amount: cat20.tracedUtxos[0].token.state.amount,
        };
        const outputToken = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, outputState);
        psbt.addCovenantOutput(outputToken, Postage.TOKEN_POSTAGE);

        const outputsToAdd = TX_OUTPUT_COUNT_MAX + 1 - psbt.txOutputs.length;

        try {
            for (let i = 0; i < outputsToAdd; i++) {
                psbt.addOutput({ address: mainAddress, value: 1000n });
            }
            const guardInputIndex = cat20.tracedUtxos.length;
            cat20.tracedUtxos.forEach((utxo, inputIndex) => {
                psbt.updateCovenantInput(inputIndex, utxo.token, {
                    invokeMethod: (contract: CAT20, curPsbt: ExtPsbt) => {
                        contract.unlock(
                            {
                                isUserSpend: true,
                                userPubKeyPrefix: mainPubKey.prefix,
                                userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                                userSig: curPsbt.getSig(inputIndex, { address: mainAddress }),
                                contractInputIndexVal: -1n,
                            },
                            guardState,
                            BigInt(guardInputIndex),
                            getBackTraceInfo_(utxo.trace.prevTxHex, utxo.trace.prevPrevTxHex, utxo.trace.prevTxInput),
                        );
                    },
                });
            });

            psbt.updateCovenantInput(guardInputIndex, guardCovenant, {
                invokeMethod: (contract: CAT20Guard, curPsbt: ExtPsbt) => {
                    const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                    const outputScripts = curPsbt.txOutputs
                        .slice(1)
                        .map((output) => toByteString(Buffer.from(output.script).toString('hex')));

                    applyArray(outputScripts, ownerAddrOrScripts, 0);

                    const outputTokens = fill(0n, STATE_OUTPUT_COUNT_MAX);
                    applyArray([outputToken.state.amount], outputTokens, 0);

                    const tokenScriptIndexes = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                    applyArray([0n], tokenScriptIndexes, 0);

                    const outputSatoshis = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                    applyArray(getOutputSatoshisList(psbt).slice(1), outputSatoshis, 0);

                    const cat20States = fill({ ownerAddr: toByteString(''), amount: 0n }, TX_INPUT_COUNT_MAX);
                    const inputCat20States = cat20.tracedUtxos.map((utxo) => utxo.token.state);
                    applyArray(inputCat20States, cat20States, 0);

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

            expect.fail('Should have thrown an error for exceeding output count limit');
        } catch (error) {
            expect(error.message).to.include('outputs which exceeds the limit of');
        }
    });

    it('should succeed when inputCount equals limit', async () => {
        const psbt = new ExtPsbt();

        const inputsToAdd = TX_INPUT_COUNT_MAX;

        try {
            for (let i = 0; i < inputsToAdd; i++) {
                psbt.spendUTXO(getDummyUtxo(mainAddress));
            }
            expect(psbt.txInputs.length).to.equal(TX_INPUT_COUNT_MAX);
        } catch (error) {
            expect.fail(`Should not have thrown an error: ${error.message}`);
        }
    });

    it('should succeed when outputCount equals limit', async () => {
        const psbt = new ExtPsbt().spendUTXO(getDummyUtxo(mainAddress));

        const outputsToAdd = STATE_OUTPUT_COUNT_MAX;

        try {
            for (let i = 0; i < outputsToAdd; i++) {
                psbt.addOutput({ address: mainAddress, value: 1000n });
            }
            expect(psbt.txOutputs.length).to.equal(STATE_OUTPUT_COUNT_MAX);
        } catch (error) {
            expect.fail(`Should not have thrown an error: ${error.message}`);
        }
    });
});
