import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ExtPsbt, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20, CAT20Covenant, CAT20Guard, CAT20State, CAT20StateLib, Postage, toTokenAddress } from '../src';
import { loadAllArtifacts } from './features/cat20/utils';
import { testSigner } from './utils/testSigner';
import { createCat20 } from './utils/testCAT20Generater';
import { CAT20GuardCovenant } from '../src/covenants/cat20GuardCovenant';
import { catToXOnly, getDummyUtxo, isP2TR, pubKeyPrefix } from '../src/lib/utils';
import {
    fill,
    getBackTraceInfo_,
    PubKey,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
} from '@scrypt-inc/scrypt-ts-btc';
import { applyArray, getOutputSatoshisList } from './utils/txHelper';

use(chaiAsPromised);

describe('Test Transfer Attack', () => {
    let mainAddress: string;
    let mainPubKey: {
        prefix: string;
        xOnlyPubKey: PubKey;
    };
    let tokenReceiverAddr: Ripemd160;

    before(async () => {
        loadAllArtifacts();
        mainAddress = await testSigner.getAddress();
        mainPubKey = {
            prefix: isP2TR(mainAddress) ? '' : pubKeyPrefix(await testSigner.getPublicKey()),
            xOnlyPubKey: PubKey(catToXOnly(await testSigner.getPublicKey(), isP2TR(mainAddress))),
        };
        tokenReceiverAddr = Ripemd160(toTokenAddress(mainAddress));
    });

    it('should fail cat20 transfer', async () => {
        const cat20 = await createCat20([10064n, 10064n], mainAddress, 'test');
        const guardState = CAT20Guard.createEmptyState();
        guardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        guardState.tokenAmounts[0] = cat20.tracedUtxos.reduce((acc, utxo) => acc + utxo.token.state.amount, 0n);
        guardState.tokenBurnAmounts[0] = 0n;
        cat20.tracedUtxos.forEach((utxo, i) => {
            guardState.inputStateHashes[i] = CAT20StateLib.stateHash<CAT20State>(utxo.token.state);
            guardState.tokenScriptIndexes[i] = 0n;
        });

        const guardCovenant = new CAT20GuardCovenant(guardState);

        {
            const psbt = new ExtPsbt().spendUTXO(getDummyUtxo(mainAddress)).addCovenantOutput(guardCovenant, 1e8);
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const guardInputIndex = cat20.tracedUtxos.length;
        const psbt = new ExtPsbt();

        cat20.tracedUtxos.forEach((utxo) => {
            psbt.addCovenantInput(utxo.token);
        });

        psbt.addCovenantInput(guardCovenant);

        const outputAmount = 5252983n;
        const outputToken = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, {
            ownerAddr: tokenReceiverAddr,
            amount: outputAmount,
        });
        psbt.addCovenantOutput(outputToken, Postage.TOKEN_POSTAGE);

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
                applyArray([tokenReceiverAddr], ownerAddrOrScripts, 0);

                const outputTokens = fill(0n, STATE_OUTPUT_COUNT_MAX);
                applyArray([outputToken.state.amount], outputTokens, 0);

                const tokenScriptIndexes = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                applyArray([0n], tokenScriptIndexes, 0);

                const outputSatoshis = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                applyArray(getOutputSatoshisList(psbt).slice(1), outputSatoshis, 0);

                const cat20States = fill({ ownerAddr: toByteString(''), amount: 0n }, TX_INPUT_COUNT_MAX);
                const inputCat20States = cat20.tracedUtxos.map((utxo) => utxo.token.state);
                applyArray(inputCat20States, cat20States, 0);
                cat20States[0].amount = 5252944n;
                cat20States[1].amount = 39n;

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

        try {
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
            expect.fail('Should have thrown an error due to transfer attack');
        } catch (error) {
            expect(error.message).to.include('Execution failed');
        }
    });
});
