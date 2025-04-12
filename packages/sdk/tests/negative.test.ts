import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ExtPsbt } from '@scrypt-inc/scrypt-ts-btc';
import {
    CAT20,
    CAT20Covenant,
    CAT20Guard,
    CAT20GuardConstState,
    CAT20State,
    CAT20StateLib,
    CAT721,
    CAT721Covenant,
    CAT721Guard,
    CAT721GuardConstState,
    CAT721StateLib,
    Postage,
} from '../src';
import { loadAllArtifacts } from './features/cat20/utils';
import { testSigner } from './utils/testSigner';
import { createCat20, TestCat20 } from './utils/testCAT20Generater';
import { createCat721, TestCat721 } from './utils/testCAT721Generater';
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

describe('Test state amount/localId negative for cat20/cat721', () => {
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

    it('should fail cat20 amount is negative', async () => {
        const cat20 = await createCat20([1000n], mainAddress, 'test');

        const negativeState: CAT20State = {
            ownerAddr: cat20.tracedUtxos[0].token.state.ownerAddr,
            amount: -1000n,
        };

        const negativeToken = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, negativeState);

        const guardState = CAT20Guard.createEmptyState();
        guardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        guardState.tokenAmounts[0] = cat20.tracedUtxos.reduce((acc, utxo) => acc + utxo.token.state.amount, 0n);
        guardState.tokenBurnAmounts[0] = 0n;

        cat20.tracedUtxos.forEach((utxo, i) => {
            guardState.inputStateHashes[i] = CAT20StateLib.stateHash(utxo.token.state);
            guardState.tokenScriptIndexes[i] = 0n;
        });

        return expect(testCat20WithNegativeAmount(cat20, negativeToken, guardState)).to.eventually.be.rejectedWith(
            'Execution failed',
        );
    });

    it('should fail cat721 localId is negative', async () => {
        const cat721 = await createCat721('test', 1, mainAddress);

        const negativeState = {
            ownerAddr: cat721.tracedUtxos[0].nft.state.ownerAddr,
            localId: -1n,
        };

        const negativeNft = new CAT721Covenant(cat721.generater.deployInfo.minterAddr, negativeState);

        const guardState = CAT721Guard.createEmptyState();
        guardState.nftScripts[0] = cat721.tracedUtxos[0].nft.lockingScriptHex;

        cat721.tracedUtxos.forEach((utxo, i) => {
            guardState.nftScriptIndexes[i] = 0n;
            guardState.inputStateHashes[i] = CAT721StateLib.stateHash(utxo.nft.state);
        });

        return expect(testCat721WithNegativeLocalId(cat721, negativeNft, guardState)).to.eventually.be.rejectedWith(
            'Execution failed',
        );
    });

    async function testCat20WithNegativeAmount(
        cat20: TestCat20,
        negativeToken: CAT20Covenant,
        guardState: CAT20GuardConstState,
    ) {
        const guardCovenant = new CAT20GuardCovenant(guardState);

        {
            const psbt = new ExtPsbt().spendUTXO(getDummyUtxo(mainAddress)).addCovenantOutput(guardCovenant, 1e8);
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        }

        const guardInputIndex = cat20.tracedUtxos.length;
        const psbt = new ExtPsbt();

        cat20.tracedUtxos.forEach((utxo, i) => {
            psbt.addCovenantInput(utxo.token);
            guardState.tokenScriptIndexes[i] = 0n;
        });

        psbt.addCovenantInput(guardCovenant);

        psbt.addCovenantOutput(negativeToken, Postage.TOKEN_POSTAGE);
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
                applyArray([negativeToken.state.ownerAddr], ownerAddrOrScripts, 0);

                const outputTokens = fill(0n, STATE_OUTPUT_COUNT_MAX);
                applyArray([negativeToken.state.amount], outputTokens, 0);

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

        const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        return psbt.isFinalized;
    }

    async function testCat721WithNegativeLocalId(
        cat721: TestCat721,
        negativeNft: CAT721Covenant,
        guardState: CAT721GuardConstState,
    ) {
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

        psbt.addCovenantOutput(negativeNft, Postage.NFT_POSTAGE);

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
                applyArray([negativeNft.state.ownerAddr], ownerAddrOrScripts, cat721OutputStartIndex - 1);

                const outputLocalIds = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                applyArray([negativeNft.state.localId], outputLocalIds, cat721OutputStartIndex - 1);

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

        const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        return psbt.isFinalized;
    }
});
