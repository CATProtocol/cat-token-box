import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { loadAllArtifacts } from './features/cat20/utils';
import { testSigner } from './utils/testSigner';
import { catToXOnly, getDummyUtxo, isP2TR, pubKeyPrefix } from '../src/lib/utils';
import { ExtPsbt, fill, getBackTraceInfo_, Int32, PubKey, STATE_OUTPUT_COUNT_MAX, toByteString, uint8ArrayToHex, TX_INPUT_COUNT_MAX } from '@scrypt-inc/scrypt-ts-btc';
import { createCat20, TestCAT20Generater } from './utils/testCAT20Generater';
import { createCat721, TestCAT721Generater } from './utils/testCAT721Generater';
import { CAT20Guard } from '../src/contracts/cat20/cat20Guard';
import { CAT721Guard } from '../src/contracts/cat721/cat721Guard';
import { CAT20Covenant, TracedCAT20Token } from '../src/covenants/cat20Covenant';
import { CAT721Covenant, TracedCAT721Nft } from '../src/covenants/cat721Covenant';
import { CAT20, CAT20GuardConstState, CAT20GuardCovenant, CAT20StateLib, CAT721, CAT721GuardConstState, CAT721GuardCovenant, Postage } from '../src';
import { CAT721StateLib } from '../src';
import { applyArray, getOutputSatoshisList } from './utils/txHelper';
use(chaiAsPromised);


/**
 * test multiple cat20 & cat721 token types transfer/burn in a single txn
 */

describe('Test multiple cat20 & cat721 token types transfer/burn in a single txn', async () => {

    let mainAddress: string;
    let mainPubKey: {
        prefix: string;
        xOnlyPubKey: PubKey;
    };


    let cat20_1: Cat20;
    let cat20_2: Cat20;
    let cat20_3: Cat20;

    let cat721_1: Cat721;
    let cat721_2: Cat721;
    let cat721_3: Cat721;

    before(async () => {
        loadAllArtifacts()
        mainAddress = await testSigner.getAddress()
        mainPubKey = {
            prefix: isP2TR(mainAddress) ? '' : pubKeyPrefix(await testSigner.getPublicKey()),
            xOnlyPubKey: PubKey(catToXOnly(await testSigner.getPublicKey(), isP2TR(mainAddress))),
        }
        cat20_1 = await _createCat20(1000n, '1');
        cat20_2 = await _createCat20(2000n, '2');
        cat20_3 = await _createCat20(3000n, '3');

        cat721_1 = await _createCat721('1');
        cat721_2 = await _createCat721('2');
        cat721_3 = await _createCat721('3');
    })

    it('txn should be success when send 2 types of cat20 tokens in a single txn', async () => {
        await TestCase.create()
            .addCat20(cat20_1, 1000n, 0n)
            .addCat20(cat20_2, 2000n, 0n)
            .test();
    })
    it('txn should be success when send 2 types of cat721 tokens in a single txn', async () => {
        await TestCase.create()
            .addCat721(cat721_1, false)
            .addCat721(cat721_2, false)
            .test();
    })
    it('txn should be success when send 1 type of cat20 & 1 type of cat721 tokens in a single txn', async () => {
        await TestCase.create()
            .addCat20(cat20_1, 1000n, 0n)
            .addCat721(cat721_1, false)
            .test();
    })

    it('txn should be success when send 3 types of cat20 tokens and burn one of them in a single txn', async () => {
        await TestCase.create()
            .addCat20(cat20_1, 1000n, 0n)
            // full burn cat20_2
            .addCat20(cat20_2, 0n, 2000n)
            .addCat20(cat20_3, 3000n, 0n)
            .test();

        await TestCase.create()
            .addCat20(cat20_1, 1000n, 0n)
            // partial burn cat20_2
            .addCat20(cat20_2, 1000n, 1000n)
            .addCat20(cat20_3, 3000n, 0n)
            .test();
    })
    it('txn should be success when send 3 types of cat721 tokens and burn one of them in a single txn', async () => {
        await TestCase.create()
            .addCat721(cat721_1, false)
            .addCat721(cat721_2, true)
            .addCat721(cat721_3, false)
            .test();
    })
    it('txn should be success when send 2 types of cat20 tokens, 2 type of cat721 tokens, and burn one of them in a single txn', async () => {
        await TestCase.create()
            .addCat20(cat20_1, 1000n, 0n)
            // full burn cat20_2
            .addCat20(cat20_2, 0n, 2000n)
            .addCat721(cat721_1, false)
            .addCat721(cat721_2, true)
            .test();
        
        await TestCase.create()
            .addCat20(cat20_1, 1000n, 0n)
            // partial burn cat20_2
            .addCat20(cat20_2, 1000n, 1000n)
            .addCat721(cat721_1, false)
            .addCat721(cat721_2, true)
            .test();
    })


    async function _createCat20(
        amount: bigint,
        symbol: string,
    ): Promise<Cat20> {
        const res = await createCat20([amount], mainAddress, symbol)
        return {
            generater: res.generater,
            utxo: res.tracedUtxos[0],
        }
    }

    async function _createCat721(symbol: string): Promise<Cat721> {
        const res = await createCat721(symbol, 1, mainAddress)
        return {
            generater: res.generater,
            utxo: res.tracedUtxos[0],
        }
    }
    
    type Cat20 = {
        generater: TestCAT20Generater;
        utxo: TracedCAT20Token;
    }
    type Cat721 = { 
        generater: TestCAT721Generater;
        utxo: TracedCAT721Nft;
    }
    class TestCase {
        cat20s: Array<{cat20: Cat20, sendAmount: bigint, burnAmount: bigint}> = [];
        cat721s: Array<{cat721: Cat721, isBurn: boolean}> = [];
        psbt: ExtPsbt;

        private tested = false;

        static create() {
            return new TestCase();
        }

        private static async createCat20GuardCovenant(guardState: CAT20GuardConstState) {
            let covenant = new CAT20GuardCovenant(guardState);
            const psbt = new ExtPsbt()
                .spendUTXO(getDummyUtxo(mainAddress))
                // 1e8 is enough for the next txn's fee
                .addCovenantOutput(covenant, 1e8)
                .seal();
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs()
            return covenant;
        }

        private static async createCat721GuardCovenant(guardState: CAT721GuardConstState) {
            let covenant = new CAT721GuardCovenant(guardState);
            const psbt = new ExtPsbt()
                .spendUTXO(getDummyUtxo(mainAddress))
                // 1e8 is enough for the next txn's fee
                .addCovenantOutput(covenant, 1e8)
                .seal();
            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs()
            return covenant;
        }

        addCat20(cat20: Cat20, sendAmount: bigint, burnAmount: bigint) {
            this.cat20s.push({cat20, sendAmount, burnAmount});
            return this;
        }

        addCat721(cat721: Cat721, isBurn: boolean) {
            this.cat721s.push({cat721, isBurn});
            return this;
        }

        async test() {
            if (this.tested) {
                throw new Error('TestCase already tested');
            }
            this.tested = true;

            const psbt = new ExtPsbt();

            let cat20GuardState = CAT20Guard.createEmptyState();
            let cat721GuardState = CAT721Guard.createEmptyState();  

            let hasCat20 = this.cat20s.length > 0;
            let hasCat721 = this.cat721s.length > 0;
            

            let inputIndex = 0;
            let cat20GuardInputIndex = -1;
            let cat721GuardInputIndex = -1;
            // first output is state hash root output
            let outputIndex = 1;
            let cat20OutputStartIndex = 1
            let cat20InputStartIndex = 0;
            let cat721OutputStartIndex = -1;
            let cat721InputStartIndex = -1;
            // let cat20ScriptInputIndexes: Int32[] = [];
            let cat20ScriptOutputIndexes: Int32[] = [];
            // let cat721ScriptInputIndexes: Int32[] = [];
            let cat721ScriptOutputIndexes: Int32[] = [];
            if (hasCat20) {
                this.cat20s.forEach(({cat20, sendAmount, burnAmount}, index) => {
                    cat20GuardState.tokenScripts[index] = cat20.utxo.token.lockingScriptHex;
                    cat20GuardState.tokenAmounts[index] = cat20.utxo.token.state.amount;
                    cat20GuardState.tokenBurnAmounts[index] = burnAmount;
                    cat20GuardState.tokenScriptIndexes[inputIndex] = BigInt(index);
                    cat20GuardState.inputStateHashes[inputIndex] = CAT20StateLib.stateHash(cat20.utxo.token.state);

                    const covenant = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, cat20.utxo.token.state);
                    covenant.bindToUtxo(cat20.utxo.token.utxo!);
                    psbt.addCovenantInput(covenant);

                    // cat20ScriptInputIndexes.push(BigInt(index));
                    if (sendAmount > 0n) {
                        // transfer to main address
                        const covenant = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, {
                            ownerAddr: cat20.utxo.token.state.ownerAddr,
                            amount: sendAmount,
                        });
                        psbt.addCovenantOutput(covenant, Postage.TOKEN_POSTAGE);
                        cat20ScriptOutputIndexes.push(BigInt(index));
                        outputIndex++;
                    }

                    inputIndex++;
                });

                cat20GuardInputIndex = inputIndex++
                let guardCovenant = await TestCase.createCat20GuardCovenant(cat20GuardState);
                psbt.addCovenantInput(guardCovenant);
            }
            if (hasCat721) {
                cat721InputStartIndex = inputIndex
                cat721OutputStartIndex = outputIndex;
                this.cat721s.forEach(({cat721, isBurn}, index) => {
                    cat721GuardState.nftScripts[index] = cat721.utxo.nft.lockingScriptHex;
                    cat721GuardState.nftBurnMasks[inputIndex] = isBurn;
                    cat721GuardState.nftScriptIndexes[inputIndex] = BigInt(index);

                    cat721GuardState.inputStateHashes[inputIndex] = CAT721StateLib.stateHash(cat721.utxo.nft.state);
                    inputIndex++;

                    const covenant = new CAT721Covenant(cat721.generater.deployInfo.minterAddr, cat721.utxo.nft.state);
                    covenant.bindToUtxo(cat721.utxo.nft.utxo!);
                    psbt.addCovenantInput(covenant);
                    if (!isBurn) {
                        // transfer to main address
                        const covenant = new CAT721Covenant(cat721.generater.deployInfo.minterAddr, {...cat721.utxo.nft.state});
                        psbt.addCovenantOutput(covenant, Postage.NFT_POSTAGE);
                        cat721ScriptOutputIndexes.push(BigInt(index));
                        outputIndex++;
                    }
                });


                cat721GuardInputIndex = inputIndex++
                let guardCovenant = await TestCase.createCat721GuardCovenant(cat721GuardState);
                psbt.addCovenantInput(guardCovenant);
            }

            if (hasCat20) {
                this.cat20s.forEach(({cat20}, index) => {
                    const inputIndex = index;
                    psbt.updateCovenantInput(inputIndex, psbt.getInputCovernant(inputIndex), {
                        invokeMethod: (contract: CAT20, curPsbt: ExtPsbt) => {
                            contract.unlock(
                                {
                                    isUserSpend: true,
                                    userPubKeyPrefix: mainPubKey.prefix,
                                    userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                                    userSig: curPsbt.getSig(inputIndex, {address: mainAddress}),
                                    contractInputIndexVal: -1n,
                                },
                                cat20GuardState,
                                BigInt(cat20GuardInputIndex),
                                getBackTraceInfo_(cat20.utxo.trace.prevTxHex, cat20.utxo.trace.prevPrevTxHex, cat20.utxo.trace.prevTxInput),
                            );
                        },
                    });
                })
                psbt.updateCovenantInput(cat20GuardInputIndex, psbt.getInputCovernant(cat20GuardInputIndex), {
                    invokeMethod: (contract: CAT20Guard, curPsbt: ExtPsbt) => {
                        const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                        {
                            // exclude the state hash root output
                            const outputScripts = curPsbt.txOutputs.slice(1).map((output) => toByteString(uint8ArrayToHex(output.script)));
                            applyArray(outputScripts, ownerAddrOrScripts, cat20OutputStartIndex - 1 );
                            const cat20OwnerAddrs = this.cat20s.filter(({sendAmount}) => sendAmount > 0n).map(({cat20}) => cat20.utxo.token.state.ownerAddr);
                            applyArray(cat20OwnerAddrs, ownerAddrOrScripts, cat20InputStartIndex);
                        }

                        const outputTokens = fill(0n, STATE_OUTPUT_COUNT_MAX);
                        {
                            const cat20OutputAmounts = this.cat20s.filter(({sendAmount}) => sendAmount > 0n).map(({sendAmount}) => sendAmount);
                            applyArray(cat20OutputAmounts, outputTokens, cat20OutputStartIndex - 1);
                        }

                        const tokenScriptIndexes = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                        {
                            applyArray(cat20ScriptOutputIndexes, tokenScriptIndexes, cat20OutputStartIndex - 1);
                        }
                        let outputSatoshis = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                        {
                            applyArray(getOutputSatoshisList(psbt).slice(1), outputSatoshis, 0);
                        }
                        const cat20States = fill({ownerAddr: toByteString(''), amount: 0n}, TX_INPUT_COUNT_MAX);
                        {
                            const inputCat20States = this.cat20s.map(({cat20}) => cat20.utxo.token.state);
                            applyArray(inputCat20States, cat20States, cat20InputStartIndex);
                        }
                        const outputCount = curPsbt.txOutputs.length - 1;   // exclude the state hash root output

                        contract.unlock(
                            ownerAddrOrScripts,
                            outputTokens,
                            tokenScriptIndexes,
                            outputSatoshis,
                            cat20States,
                            BigInt(outputCount),
                        )
                    }
                })
            }

            if (hasCat721) {
                this.cat721s.forEach(({cat721, isBurn}, index) => {
                    const inputIndex = cat721InputStartIndex + index;
                    psbt.updateCovenantInput(inputIndex, psbt.getInputCovernant(inputIndex), {
                        invokeMethod: (contract: CAT721, curPsbt: ExtPsbt) => {
                            contract.unlock(
                                {
                                    isUserSpend: true,
                                    userPubKeyPrefix: mainPubKey.prefix,
                                    userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                                    userSig: curPsbt.getSig(inputIndex, {address: mainAddress}),
                                    contractInputIndexVal: -1n,
                                },
                                cat721GuardState,
                                BigInt(cat721GuardInputIndex),
                                getBackTraceInfo_(cat721.utxo.trace.prevTxHex, cat721.utxo.trace.prevPrevTxHex, cat721.utxo.trace.prevTxInput),

                            )
                        }
                    })

                })
                
                psbt.updateCovenantInput(cat721GuardInputIndex, psbt.getInputCovernant(cat721GuardInputIndex), {
                    invokeMethod: (contract: CAT721Guard, curPsbt: ExtPsbt) => {
                        
                        const ownerAddrOrScripts = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                        {
                            // exclude the state hash root output
                            const outputScripts = curPsbt.txOutputs.slice(1).map((output) => toByteString(uint8ArrayToHex(output.script)));
                            applyArray(outputScripts, ownerAddrOrScripts, 0);
                            const cat721OwnerAddrs = this.cat721s.filter(({isBurn}) => !isBurn).map(({cat721}) => cat721.utxo.nft.state.ownerAddr);
                            applyArray(cat721OwnerAddrs, ownerAddrOrScripts, cat721OutputStartIndex - 1);
                        }

                        const outputLocalIds = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                        {
                            const cat721OutputLocalIds = this.cat721s.filter(({isBurn}) => !isBurn).map(({cat721}) => cat721.utxo.nft.state.localId)
                            applyArray(cat721OutputLocalIds, outputLocalIds, 0);
                        }

                        const nftScriptIndexes = fill(-1n, STATE_OUTPUT_COUNT_MAX);
                        {
                            applyArray(cat721ScriptOutputIndexes, nftScriptIndexes, cat721OutputStartIndex -1);
                        }
                        
                        let outputSatoshis = fill(toByteString(''), STATE_OUTPUT_COUNT_MAX);
                        {
                            applyArray(getOutputSatoshisList(psbt).slice(1), outputSatoshis, 0);
                        }
                        const cat721States = fill({ownerAddr: toByteString(''), amount: 0n, localId: 0n}, TX_INPUT_COUNT_MAX);
                        {
                            const inputCat721States = this.cat721s.map(({cat721}) => cat721.utxo.nft.state);
                            applyArray(inputCat721States, cat721States, cat721InputStartIndex);
                        }
                        const outputCount = curPsbt.txOutputs.length - 1;   // exclude the state hash root output

                        contract.unlock(
                            ownerAddrOrScripts,
                            outputLocalIds,
                            nftScriptIndexes,
                            outputSatoshis,
                            cat721States,
                            BigInt(outputCount),
                        )
                    }
                })
            }

            const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
            psbt.combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs()
            expect(psbt.isFinalized).to.be.true;

        }
    }
})
