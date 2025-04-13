import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import { getDummyUtxo, pubKeyPrefix } from '../src/lib/utils';
import { catToXOnly } from '../src/lib/utils';
import {
    ExtPsbt,
    fill,
    getBackTraceInfo,
    PubKey,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
    uint8ArrayToHex,
} from '@scrypt-inc/scrypt-ts-btc';
import { loadAllArtifacts } from './features/cat20/utils';
import { testSigner } from './utils/testSigner';
import { isP2TR } from '../src/lib/utils';
import { CAT721Covenant } from '../src/covenants/cat721Covenant';
import { TestCat721, createCat721 } from './utils/testCAT721Generater';
import { CAT721Guard } from '../src/contracts/cat721/cat721Guard';
import { CAT721StateLib } from '../src/contracts/cat721/cat721State';
import { CAT721, CAT721GuardCovenant, Postage } from '../src';
import { applyArray, getOutputSatoshisList } from './utils/txHelper';
import chaiAsPromised from 'chai-as-promised';

use(chaiAsPromised);

describe('Test cat721 incorrect amount/localId', async () => {
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

    it('should be success on transfer, burn, and both when input amount is equal to output amount', async () => {
        const cat721 = await createCat721('test', 2, mainAddress);
        await testCase(cat721, [0n, 1n], []);
        // await testCase(cat721, [], [0n, 1n])
        await testCase(cat721, [0n], [1n]);
    });

    describe('should be failed when output amount is less than the input amount', async () => {
        it('failed on transfer: 2 inputs, 1 output', async () => {
            const cat721 = await createCat721('test', 2, mainAddress);
            return expect(testCase(cat721, [0n], [])).to.eventually.be.rejectedWith(
                'Failed to finalize input 2: Execution failed, Error: Execution failed',
            );
        });
        it('failed on burn: 3 inputs, 1 output, 1 burn', async () => {
            const cat721 = await createCat721('test', 3, mainAddress);
            return expect(testCase(cat721, [0n], [1n])).to.eventually.be.rejectedWith(
                'Failed to finalize input 3: Execution failed, Error: Execution failed',
            );
        });
    });

    describe('should be failed when output amount is greater than the input amount', async () => {
        it('failed on transfer: 2 inputs, 3 output', async () => {
            const cat721 = await createCat721('test', 2, mainAddress);
            return expect(testCase(cat721, [0n, 1n, 3n], [])).to.eventually.be.rejectedWith(
                'Failed to finalize input 2: Execution failed, Error: Execution failed',
            );
        });
        it('failed on burn: 1 inputs, 1 output, 1 burn', async () => {
            const cat721 = await createCat721('test', 1, mainAddress);
            return expect(testCase(cat721, [0n], [0n])).to.eventually.be.rejectedWith(
                'Failed to finalize input 1: Execution failed, Error: Execution failed',
            );
        });
        it('failed on both transfer and burn: 1 inputs, 2 output, 1 burn', async () => {
            const cat721 = await createCat721('test', 1, mainAddress);
            return expect(testCase(cat721, [0n, 1n], [2n])).to.eventually.be.rejectedWith(
                'Failed to finalize input 1: Execution failed, Error: Execution failed',
            );
        });
    });

    async function testCase(cat721: TestCat721, outputLocalIds: bigint[], burnLocalIds: bigint[]) {
        const guardState = CAT721Guard.createEmptyState();

        // only 1 type token
        guardState.nftScripts[0] = cat721.tracedUtxos[0].nft.lockingScriptHex;
        cat721.tracedUtxos.forEach((utxo, inputIndex) => {
            // set burn mask
            if (burnLocalIds.includes(BigInt(utxo.nft.state.localId))) {
                guardState.nftBurnMasks[inputIndex] = true;
            }

            guardState.nftScriptIndexes[inputIndex] = BigInt(0);
            guardState.inputStateHashes[inputIndex] = CAT721StateLib.stateHash(utxo.nft.state);
        });

        const guardCovenant = new CAT721GuardCovenant(guardState);
        {
            const psbt = new ExtPsbt()
                .spendUTXO(getDummyUtxo(mainAddress))
                // 1e8 is enough for the next txn's fee
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
        outputLocalIds.forEach((localId) => {
            const covenant = new CAT721Covenant(cat721.generater.deployInfo.minterAddr, {
                ownerAddr: cat721.tracedUtxos[0].nft.state.ownerAddr,
                localId: localId,
            });
            psbt.addCovenantOutput(covenant, Postage.NFT_POSTAGE);
        });

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

        const outputHasCat721 = outputLocalIds.length > 0;
        const cat721OutputStartIndex = 1;
        const cat721InputStartIndex = 0;
        const outputStates = outputLocalIds.map((localId) => {
            return {
                ownerAddr: cat721.tracedUtxos[0].nft.state.ownerAddr,
                localId: localId,
            };
        });
        psbt.updateCovenantInput(guardInputIndex, guardCovenant, {
            invokeMethod: (contract: CAT721Guard, curPsbt: ExtPsbt) => {
                const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                {
                    if (outputHasCat721) {
                        // exclude the state hash root output
                        const outputScripts = curPsbt.txOutputs
                            .slice(1)
                            .map((output) => toByteString(uint8ArrayToHex(output.script)));
                        applyArray(outputScripts, ownerAddrOrScripts, cat721OutputStartIndex - 1);
                        const cat721OwnerAddrs = outputStates.map((state) => state.ownerAddr);
                        applyArray(cat721OwnerAddrs, ownerAddrOrScripts, cat721OutputStartIndex - 1);
                    } else {
                        const outputScripts = curPsbt.txOutputs.map((output) =>
                            toByteString(uint8ArrayToHex(output.script)),
                        );
                        applyArray(outputScripts, ownerAddrOrScripts, 0);
                    }
                }
                const _outputLocalIds = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                {
                    if (outputHasCat721) {
                        applyArray(outputLocalIds, _outputLocalIds, cat721OutputStartIndex - 1);
                    }
                }
                const nftScriptIndexes = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                {
                    if (outputHasCat721) {
                        applyArray(
                            outputLocalIds.map(() => 0n),
                            nftScriptIndexes,
                            cat721OutputStartIndex - 1,
                        );
                    }
                }
                const outputSatoshis = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                {
                    applyArray(getOutputSatoshisList(psbt).slice(outputHasCat721 ? 1 : 0), outputSatoshis, 0);
                }
                const cat721States = fill({ ownerAddr: toByteString(''), localId: 0n }, TX_INPUT_COUNT_MAX);
                {
                    applyArray(
                        cat721.tracedUtxos.map((utxo) => utxo.nft.state),
                        cat721States,
                        cat721InputStartIndex,
                    );
                }
                const outputCount = outputHasCat721 ? curPsbt.txOutputs.length - 1 : curPsbt.txOutputs.length; // exclude the state hash root output
                contract.unlock(
                    ownerAddrOrScripts,
                    _outputLocalIds,
                    nftScriptIndexes,
                    outputSatoshis,
                    cat721States,
                    BigInt(outputCount),
                );
            },
        });

        const signedPsbtHex = await testSigner.signPsbt(psbt.seal().toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        expect(psbt.isFinalized).to.be.true;
    }
});
