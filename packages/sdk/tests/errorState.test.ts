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
import {
    CAT20,
    CAT20Guard,
    CAT20GuardConstState,
    CAT20State,
    CAT20StateLib,
    CAT721GuardConstState,
    Postage,
} from '../src';
import { CAT20GuardCovenant } from '../src/covenants/cat20GuardCovenant';
import { applyArray, getOutputSatoshisList } from './utils/txHelper';
import { CAT721Covenant } from '../src/covenants/cat721Covenant';
import { TestCat721, createCat721 } from './utils/testCAT721Generater';
import { CAT721Guard } from '../src/contracts/cat721/cat721Guard';
import { CAT721StateLib } from '../src/contracts/cat721/cat721State';
import { CAT721, CAT721GuardCovenant } from '../src';

use(chaiAsPromised);

describe('Test incorrect state for cat20/cat721', () => {
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

    it('should fail cat20 state incorrect, cat20Guard state correct', async () => {
        const cat20 = await createCat20([1000n], mainAddress, 'test');

        const incorrectState: CAT20State = {
            ownerAddr: cat20.tracedUtxos[0].token.state.ownerAddr,
            amount: cat20.tracedUtxos[0].token.state.amount + 1n,
        };

        const guardState = CAT20Guard.createEmptyState();
        guardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        guardState.tokenAmounts[0] = cat20.tracedUtxos.reduce((acc, utxo) => acc + utxo.token.state.amount, 0n);
        guardState.tokenBurnAmounts[0] = 0n;

        cat20.tracedUtxos.forEach((utxo, i) => {
            guardState.inputStateHashes[i] = CAT20StateLib.stateHash(utxo.token.state);
            guardState.tokenScriptIndexes[i] = 0n;
        });

        const incorrectToken = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, incorrectState);

        return expect(testCat20WithIncorrectState(cat20, incorrectToken, guardState)).to.eventually.be.rejectedWith(
            'Execution failed',
        );
    });

    it('should fail cat20 state correct, cat20Guard state incorrect', async () => {
        const cat20 = await createCat20([1000n], mainAddress, 'test');

        const incorrectGuardState = CAT20Guard.createEmptyState();
        incorrectGuardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        incorrectGuardState.tokenAmounts[0] = 2000n;
        incorrectGuardState.tokenBurnAmounts[0] = 0n;

        cat20.tracedUtxos.forEach((utxo, i) => {
            incorrectGuardState.inputStateHashes[i] = CAT20StateLib.stateHash(utxo.token.state);
            incorrectGuardState.tokenScriptIndexes[i] = 0n;
        });

        return expect(testCat20WithIncorrectGuard(cat20, incorrectGuardState)).to.eventually.be.rejectedWith(
            'Execution failed',
        );
    });

    it('should fail cat20 state incorrect, cat20Guard state incorrect', async () => {
        const cat20 = await createCat20([1000n], mainAddress, 'test');

        const incorrectState: CAT20State = {
            ownerAddr: cat20.tracedUtxos[0].token.state.ownerAddr,
            amount: cat20.tracedUtxos[0].token.state.amount + 1n,
        };

        const incorrectGuardState = CAT20Guard.createEmptyState();
        incorrectGuardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        incorrectGuardState.tokenAmounts[0] = 2000n;
        incorrectGuardState.tokenBurnAmounts[0] = 0n;

        cat20.tracedUtxos.forEach((utxo, i) => {
            incorrectGuardState.inputStateHashes[i] = CAT20StateLib.stateHash(utxo.token.state);
            incorrectGuardState.tokenScriptIndexes[i] = 0n;
        });

        const incorrectToken = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, incorrectState);

        return expect(
            testCat20WithIncorrectState(cat20, incorrectToken, incorrectGuardState),
        ).to.eventually.be.rejectedWith('Execution failed');
    });

    it('should fail cat721 state incorrect, cat721Guard state correct', async () => {
        const cat721 = await createCat721('test', 2, mainAddress);

        const incorrectState = {
            ownerAddr: cat721.tracedUtxos[0].nft.state.ownerAddr,
            localId: cat721.tracedUtxos[0].nft.state.localId + 1n,
        };

        const guardState = CAT721Guard.createEmptyState();
        guardState.nftScripts[0] = cat721.tracedUtxos[0].nft.lockingScriptHex;

        cat721.tracedUtxos.forEach((utxo, i) => {
            guardState.nftScriptIndexes[i] = 0n;
            guardState.inputStateHashes[i] = CAT721StateLib.stateHash(utxo.nft.state);
        });

        const incorrectNft = new CAT721Covenant(cat721.generater.deployInfo.minterAddr, incorrectState);

        return expect(testCat721WithIncorrectState(cat721, incorrectNft, guardState)).to.eventually.be.rejectedWith(
            'Execution failed',
        );
    });

    it('should fail cat721 state correct, cat721Guard state incorrect', async () => {
        const cat721 = await createCat721('test', 2, mainAddress);

        const incorrectGuardState = CAT721Guard.createEmptyState();
        incorrectGuardState.nftScripts[0] = cat721.tracedUtxos[0].nft.lockingScriptHex;

        cat721.tracedUtxos.forEach((utxo, i) => {
            incorrectGuardState.nftScriptIndexes[i] = 0n;
            incorrectGuardState.inputStateHashes[i] = toByteString('');
        });

        return expect(testCat721WithIncorrectGuard(cat721, incorrectGuardState)).to.eventually.be.rejectedWith(
            'Execution failed',
        );
    });

    it('should fail cat721 state incorrect, cat721Guard state incorrect', async () => {
        const cat721 = await createCat721('test', 2, mainAddress);

        const incorrectState = {
            ownerAddr: cat721.tracedUtxos[0].nft.state.ownerAddr,
            localId: cat721.tracedUtxos[0].nft.state.localId + 1n,
        };

        const incorrectGuardState = CAT721Guard.createEmptyState();
        incorrectGuardState.nftScripts[0] = cat721.tracedUtxos[0].nft.lockingScriptHex;

        cat721.tracedUtxos.forEach((utxo, i) => {
            incorrectGuardState.nftScriptIndexes[i] = 0n;
            incorrectGuardState.inputStateHashes[i] = toByteString('');
        });

        const incorrectNft = new CAT721Covenant(cat721.generater.deployInfo.minterAddr, incorrectState);

        return expect(
            testCat721WithIncorrectState(cat721, incorrectNft, incorrectGuardState),
        ).to.eventually.be.rejectedWith('Execution failed');
    });

    async function testCat20WithIncorrectState(
        cat20: TestCat20,
        incorrectToken: CAT20Covenant,
        guardState: CAT20GuardConstState,
    ) {
        const guardCovenant = new CAT20GuardCovenant(guardState);
        {
            const psbt = new ExtPsbt().spendUTXO(getDummyUtxo(mainAddress)).addCovenantOutput(guardCovenant, 1e8);
            const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const guardInputIndex = cat20.tracedUtxos.length;
        const psbt = new ExtPsbt();
        cat20.tracedUtxos.forEach((utxo, i) => {
            psbt.addCovenantInput(utxo.token);
            guardState.tokenScriptIndexes[i] = 0n;
        });
        psbt.addCovenantInput(guardCovenant);

        psbt.addCovenantOutput(incorrectToken, Postage.TOKEN_POSTAGE);
        psbt.change(mainAddress, 0);

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
                const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                const outputScripts = curPsbt.txOutputs
                    .slice(1)
                    .map((output) => toByteString(uint8ArrayToHex(output.script)));
                applyArray(outputScripts, ownerAddrOrScripts, 0);
                applyArray([incorrectToken.state.ownerAddr], ownerAddrOrScripts, 0);

                const outputTokens = fill(0n, STATE_OUTPUT_COUNT_MAX);
                applyArray([incorrectToken.state.amount], outputTokens, 0);

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

        const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        return psbt.isFinalized;
    }

    async function testCat20WithIncorrectGuard(cat20: TestCat20, incorrectGuardState: CAT20GuardConstState) {
        const guardCovenant = new CAT20GuardCovenant(incorrectGuardState);
        {
            const psbt = new ExtPsbt().spendUTXO(getDummyUtxo(mainAddress)).addCovenantOutput(guardCovenant, 1e8);
            const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const guardInputIndex = cat20.tracedUtxos.length;
        const psbt = new ExtPsbt();
        cat20.tracedUtxos.forEach((utxo, i) => {
            psbt.addCovenantInput(utxo.token);
            incorrectGuardState.tokenScriptIndexes[i] = 0n;
        });
        psbt.addCovenantInput(guardCovenant);

        // Add correct token as output
        const outputState: CAT20State = {
            ownerAddr: cat20.tracedUtxos[0].token.state.ownerAddr,
            amount: 1000n,
        };
        const outputToken = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, outputState);
        psbt.addCovenantOutput(outputToken, Postage.TOKEN_POSTAGE);
        psbt.change(mainAddress, 0);

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
                        incorrectGuardState,
                        BigInt(guardInputIndex),
                        getBackTraceInfo(utxo.trace.prevTxHex, utxo.trace.prevPrevTxHex, utxo.trace.prevTxInput),
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

        const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        return psbt.isFinalized;
    }

    async function testCat721WithIncorrectState(
        cat721: TestCat721,
        incorrectNft: CAT721Covenant,
        guardState: CAT721GuardConstState,
    ) {
        const guardCovenant = new CAT721GuardCovenant(guardState);
        {
            const psbt = new ExtPsbt()
                .spendUTXO(getDummyUtxo(mainAddress))
                .addCovenantOutput(guardCovenant, 1e8)
                .seal();
            const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const psbt = new ExtPsbt();
        cat721.tracedUtxos.forEach((utxo) => {
            psbt.addCovenantInput(utxo.nft);
        });
        psbt.addCovenantInput(guardCovenant);
        const guardInputIndex = cat721.tracedUtxos.length;

        // Add incorrect NFT as output
        psbt.addCovenantOutput(incorrectNft, Postage.NFT_POSTAGE);

        cat721.tracedUtxos.forEach((utxo, inputIndex) => {
            psbt.updateCovenantInput(inputIndex, utxo.nft, {
                invokeMethod: (contract: CAT721, curPsbt: ExtPsbt) => {
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

        const cat721OutputStartIndex = 1;
        const cat721InputStartIndex = 0;

        psbt.updateCovenantInput(guardInputIndex, guardCovenant, {
            invokeMethod: (contract: CAT721Guard, curPsbt: ExtPsbt) => {
                const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                const outputScripts = curPsbt.txOutputs
                    .slice(1)
                    .map((output) => toByteString(uint8ArrayToHex(output.script)));
                applyArray(outputScripts, ownerAddrOrScripts, cat721OutputStartIndex - 1);
                applyArray([incorrectNft.state.ownerAddr], ownerAddrOrScripts, cat721OutputStartIndex - 1);

                const outputLocalIds = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                applyArray([incorrectNft.state.localId], outputLocalIds, cat721OutputStartIndex - 1);

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

        const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        return psbt.isFinalized;
    }

    async function testCat721WithIncorrectGuard(cat721: TestCat721, incorrectGuardState: CAT721GuardConstState) {
        const guardCovenant = new CAT721GuardCovenant(incorrectGuardState);
        {
            const psbt = new ExtPsbt()
                .spendUTXO(getDummyUtxo(mainAddress))
                .addCovenantOutput(guardCovenant, 1e8)
                .seal();
            const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const psbt = new ExtPsbt();
        cat721.tracedUtxos.forEach((utxo) => {
            psbt.addCovenantInput(utxo.nft);
        });
        psbt.addCovenantInput(guardCovenant);
        const guardInputIndex = cat721.tracedUtxos.length;

        // Add correct NFT as output
        const outputNft = new CAT721Covenant(cat721.generater.deployInfo.minterAddr, {
            ownerAddr: cat721.tracedUtxos[0].nft.state.ownerAddr,
            localId: cat721.tracedUtxos[0].nft.state.localId,
        });
        psbt.addCovenantOutput(outputNft, Postage.NFT_POSTAGE);

        cat721.tracedUtxos.forEach((utxo, inputIndex) => {
            psbt.updateCovenantInput(inputIndex, utxo.nft, {
                invokeMethod: (contract: CAT721, curPsbt: ExtPsbt) => {
                    contract.unlock(
                        {
                            userPubKeyPrefix: mainPubKey.prefix,
                            userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                            userSig: curPsbt.getSig(inputIndex, { address: mainAddress }),
                            contractInputIndexVal: -1n,
                        },
                        incorrectGuardState,
                        BigInt(guardInputIndex),
                        getBackTraceInfo(utxo.trace.prevTxHex, utxo.trace.prevPrevTxHex, utxo.trace.prevTxInput),
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

        const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        return psbt.isFinalized;
    }
});
