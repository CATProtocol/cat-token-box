import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ExtPsbt, Ripemd160 } from '@scrypt-inc/scrypt-ts-btc';
import {
    CAT20,
    CAT20Covenant,
    CAT20Guard,
    CAT20StateLib,
    CAT721,
    CAT721Covenant,
    CAT721Guard,
    CAT721StateLib,
    Postage,
    toTokenAddress,
} from '../src';
import { loadAllArtifacts } from './features/cat20/utils';
import { testSigner } from './utils/testSigner';
import { createCat20 } from './utils/testCAT20Generater';
import { createCat721 } from './utils/testCAT721Generater';
import { CAT20GuardCovenant } from '../src/covenants/cat20GuardCovenant';
import { CAT721GuardCovenant } from '../src/covenants/cat721GuardCovenant';
import { catToXOnly, getDummyUtxo, isP2TR, pubKeyPrefix } from '../src/lib/utils';
import {
    fill,
    getBackTraceInfo,
    PubKey,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
    uint8ArrayToHex,
} from '@scrypt-inc/scrypt-ts-btc';
import { applyArray, getOutputSatoshisList } from './utils/txHelper';

use(chaiAsPromised);

describe('Test Incorrect BacktraceInfo', () => {
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
        const cat20 = await createCat20([1000n], mainAddress, 'test');

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

        const guardInputIndex = cat20.tracedUtxos.length;
        const psbt = new ExtPsbt();

        cat20.tracedUtxos.forEach((utxo) => {
            psbt.addCovenantInput(utxo.token);
        });

        psbt.addCovenantInput(guardCovenant);

        const outputAmount = 1000n;
        const outputToken = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, {
            ownerAddr: tokenReceiverAddr,
            amount: outputAmount,
        });
        psbt.addCovenantOutput(outputToken, Postage.TOKEN_POSTAGE);

        cat20.tracedUtxos.forEach((utxo, inputIndex) => {
            psbt.updateCovenantInput(inputIndex, utxo.token, {
                invokeMethod: (contract: CAT20, curPsbt: ExtPsbt) => {
                    const incorrectBacktraceInfo = getBackTraceInfo(
                        utxo.trace.prevTxHex,
                        utxo.trace.prevTxHex,
                        utxo.trace.prevTxInput,
                    );

                    contract.unlock(
                        {
                            userPubKeyPrefix: mainPubKey.prefix,
                            userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                            userSig: curPsbt.getSig(inputIndex, { address: mainAddress }),
                            contractInputIndexVal: -1n,
                        },
                        guardState,
                        BigInt(guardInputIndex),
                        incorrectBacktraceInfo,
                    );
                },
            });
        });

        psbt.updateCovenantInput(guardInputIndex, guardCovenant, {
            invokeMethod: (contract: CAT20Guard, curPsbt: ExtPsbt) => {
                const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                const outputScripts = curPsbt.txOutputs
                    .slice(1)
                    .map((output) => toByteString(uint8ArrayToHex(output.script)));
                applyArray(outputScripts, ownerAddrOrScripts, 0);
                applyArray([outputToken.state.ownerAddr], ownerAddrOrScripts, 0);

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

        try {
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
            expect.fail('Should have thrown an error due to incorrect backtrace info');
        } catch (error) {
            expect(error.message).to.include('Execution failed');
        }
    });

    it('should fail cat721 transfer', async () => {
        const cat721 = await createCat721('test', 1, mainAddress);

        const guardState = CAT721Guard.createEmptyState();
        guardState.nftScripts[0] = cat721.tracedUtxos[0].nft.lockingScriptHex;

        cat721.tracedUtxos.forEach((utxo, i) => {
            guardState.nftScriptIndexes[i] = 0n;
            guardState.inputStateHashes[i] = CAT721StateLib.stateHash(utxo.nft.state);
        });

        const guardCovenant = new CAT721GuardCovenant(guardState);

        {
            const psbt = new ExtPsbt()
                .spendUTXO(getDummyUtxo(mainAddress))
                .addCovenantOutput(guardCovenant, 1e8)
                .seal();
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const psbt = new ExtPsbt();

        cat721.tracedUtxos.forEach((utxo) => {
            psbt.addCovenantInput(utxo.nft);
        });

        psbt.addCovenantInput(guardCovenant);
        const guardInputIndex = cat721.tracedUtxos.length;

        const outputNft = new CAT721Covenant(cat721.generater.deployInfo.minterAddr, {
            ownerAddr: tokenReceiverAddr,
            localId: cat721.tracedUtxos[0].nft.state.localId,
        });
        psbt.addCovenantOutput(outputNft, Postage.NFT_POSTAGE);

        cat721.tracedUtxos.forEach((utxo, inputIndex) => {
            psbt.updateCovenantInput(inputIndex, utxo.nft, {
                invokeMethod: (contract: CAT721, curPsbt: ExtPsbt) => {
                    const incorrectBacktraceInfo = getBackTraceInfo(
                        utxo.trace.prevTxHex,
                        utxo.trace.prevPrevTxHex,
                        // error input index
                        3,
                    );

                    contract.unlock(
                        {
                            userPubKeyPrefix: mainPubKey.prefix,
                            userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                            userSig: curPsbt.getSig(inputIndex, { address: mainAddress }),
                            contractInputIndexVal: -1n,
                        },
                        guardState,
                        BigInt(guardInputIndex),
                        incorrectBacktraceInfo,
                    );
                },
            });
        });

        const cat721OutputStartIndex = 1;
        const cat721InputStartIndex = 0;

        psbt.updateCovenantInput(guardInputIndex, guardCovenant, {
            invokeMethod: (contract: CAT721Guard, curPsbt: ExtPsbt) => {
                const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                const outputScripts = curPsbt.txOutputs
                    .slice(1)
                    .map((output) => toByteString(uint8ArrayToHex(output.script)));
                applyArray(outputScripts, ownerAddrOrScripts, cat721OutputStartIndex - 1);
                applyArray([outputNft.state.ownerAddr], ownerAddrOrScripts, cat721OutputStartIndex - 1);

                const outputLocalIds = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                applyArray([outputNft.state.localId], outputLocalIds, cat721OutputStartIndex - 1);

                const nftScriptIndexes = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                applyArray([0n], nftScriptIndexes, cat721OutputStartIndex - 1);

                const outputSatoshis = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                applyArray(getOutputSatoshisList(psbt).slice(1), outputSatoshis, 0);

                const cat721States = fill({ ownerAddr: toByteString(''), localId: 0n }, TX_INPUT_COUNT_MAX);
                applyArray(
                    cat721.tracedUtxos.map((utxo) => utxo.nft.state),
                    cat721States,
                    cat721InputStartIndex,
                );

                const outputCount = curPsbt.txOutputs.length - 1; // exclude the state hash root output
                contract.unlock(
                    ownerAddrOrScripts,
                    outputLocalIds,
                    nftScriptIndexes,
                    outputSatoshis,
                    cat721States,
                    BigInt(outputCount),
                );
            },
        });

        try {
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
            expect.fail('Should have thrown an error due to incorrect backtrace info');
        } catch (error) {
            expect(error.message).to.include('Execution failed');
        }
    });
});
