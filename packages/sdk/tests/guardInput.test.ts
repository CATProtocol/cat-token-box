import * as dotenv from 'dotenv';
dotenv.config();

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createCat20 } from './utils/testCAT20Generater';
import { testSigner } from './utils/testSigner';
use(chaiAsPromised);

import { createCat721 } from './utils/testCAT721Generater';
import {
    CAT20,
    CAT20Guard,
    CAT721,
    CAT721Covenant,
    CAT721Guard,
    catToXOnly,
    getDummyUtxo,
    isP2TR,
    pubKeyPrefix,
} from '../src';
import { ExtPsbt, getBackTraceInfo_, PubKey } from '@scrypt-inc/scrypt-ts-btc';
import { CAT20Covenant, Postage } from '../src';
import { loadAllArtifacts } from './features/cat20/utils';

describe('Test the guard input, fake or missing', async () => {
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

    it('should be failed when cat20 guard input is missing', async () => {
        const cat20 = await createCat20([1000n, 2000n], mainAddress, 'test');
        // tx: cat20 + cat20 + fee => cat20 + change;

        const guardState = CAT20Guard.createEmptyState();
        guardState.inputStateHashes[0] = cat20.tracedUtxos[0].token.stateHash;
        guardState.inputStateHashes[1] = cat20.tracedUtxos[1].token.stateHash;
        guardState.tokenScripts[0] = cat20.tracedUtxos[0].token.lockingScriptHex;
        guardState.tokenAmounts[0] = cat20.tracedUtxos.reduce((acc, utxo) => acc + utxo.token.state.amount, 0n);
        guardState.tokenScriptIndexes[0] = 0n;
        guardState.tokenScriptIndexes[1] = 0n;

        const outputCat20Covenant = new CAT20Covenant(cat20.generater.deployInfo.minterAddr, {
            ownerAddr: cat20.tracedUtxos[0].token.state.ownerAddr,
            amount: cat20.tracedUtxos.reduce((acc, utxo) => acc + utxo.token.state.amount, 0n),
        });

        const psbt = new ExtPsbt()
            .addCovenantInput(cat20.tracedUtxos[0].token)
            .addCovenantInput(cat20.tracedUtxos[1].token)
            .spendUTXO(getDummyUtxo(mainAddress))
            .addCovenantOutput(outputCat20Covenant, Postage.TOKEN_POSTAGE)
            .change(mainAddress, 0)
            .updateCovenantInput(0, cat20.tracedUtxos[0].token, {
                invokeMethod: (contract: CAT20, curPsbt: ExtPsbt) => {
                    contract.unlock(
                        {
                            isUserSpend: true,
                            userPubKeyPrefix: mainPubKey.prefix,
                            userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                            userSig: curPsbt.getSig(0, { address: mainAddress }),
                            contractInputIndexVal: -1n,
                        },
                        guardState,
                        BigInt(2),
                        getBackTraceInfo_(
                            cat20.tracedUtxos[0].trace.prevTxHex,
                            cat20.tracedUtxos[0].trace.prevPrevTxHex,
                            cat20.tracedUtxos[0].trace.prevTxInput,
                        ),
                    );
                },
            })
            .updateCovenantInput(1, cat20.tracedUtxos[1].token, {
                invokeMethod: (contract: CAT20, curPsbt: ExtPsbt) => {
                    contract.unlock(
                        {
                            isUserSpend: true,
                            userPubKeyPrefix: mainPubKey.prefix,
                            userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                            userSig: curPsbt.getSig(1, { address: mainAddress }),
                            contractInputIndexVal: -1n,
                        },
                        guardState,
                        BigInt(2),
                        getBackTraceInfo_(
                            cat20.tracedUtxos[1].trace.prevTxHex,
                            cat20.tracedUtxos[1].trace.prevPrevTxHex,
                            cat20.tracedUtxos[1].trace.prevTxInput,
                        ),
                    );
                },
            });

        const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex));

        expect(() => psbt.finalizeAllInputs()).to.throw(
            'Failed to finalize input 0: Execution failed, Error: Execution failed',
        );
    });

    it('should be failed when cat721 guard input is missing', async () => {
        const cat721 = await createCat721('test', 2, mainAddress);
        // tx: cat721 + cat721 + fee => cat721 + cat721 + change;

        const guardState = CAT721Guard.createEmptyState();
        guardState.inputStateHashes[0] = cat721.tracedUtxos[0].nft.stateHash;
        guardState.inputStateHashes[1] = cat721.tracedUtxos[1].nft.stateHash;
        guardState.nftScripts[0] = cat721.tracedUtxos[0].nft.lockingScriptHex;
        guardState.nftScriptIndexes[0] = 0n;
        guardState.nftScriptIndexes[1] = 0n;

        const outputCat721Covenants = cat721.tracedUtxos.map((utxo) => {
            return new CAT721Covenant(cat721.generater.deployInfo.minterAddr, {
                ownerAddr: utxo.nft.state.ownerAddr,
                localId: utxo.nft.state.localId,
            });
        });

        const psbt = new ExtPsbt()
            .addCovenantInput(cat721.tracedUtxos[0].nft)
            .addCovenantInput(cat721.tracedUtxos[1].nft)
            .spendUTXO(getDummyUtxo(mainAddress))
            .addCovenantOutput(outputCat721Covenants[0], Postage.TOKEN_POSTAGE)
            .addCovenantOutput(outputCat721Covenants[1], Postage.TOKEN_POSTAGE)
            .change(mainAddress, 0)
            .updateCovenantInput(0, cat721.tracedUtxos[0].nft, {
                invokeMethod: (contract: CAT721, curPsbt: ExtPsbt) => {
                    contract.unlock(
                        {
                            isUserSpend: true,
                            userPubKeyPrefix: mainPubKey.prefix,
                            userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                            userSig: curPsbt.getSig(0, { address: mainAddress }),
                            contractInputIndexVal: -1n,
                        },
                        guardState,
                        BigInt(2),
                        getBackTraceInfo_(
                            cat721.tracedUtxos[0].trace.prevTxHex,
                            cat721.tracedUtxos[0].trace.prevPrevTxHex,
                            cat721.tracedUtxos[0].trace.prevTxInput,
                        ),
                    );
                },
            })
            .updateCovenantInput(1, cat721.tracedUtxos[1].nft, {
                invokeMethod: (contract: CAT721, curPsbt: ExtPsbt) => {
                    contract.unlock(
                        {
                            isUserSpend: true,
                            userPubKeyPrefix: mainPubKey.prefix,
                            userXOnlyPubKey: mainPubKey.xOnlyPubKey,
                            userSig: curPsbt.getSig(1, { address: mainAddress }),
                            contractInputIndexVal: -1n,
                        },
                        guardState,
                        BigInt(2),
                        getBackTraceInfo_(
                            cat721.tracedUtxos[1].trace.prevTxHex,
                            cat721.tracedUtxos[1].trace.prevPrevTxHex,
                            cat721.tracedUtxos[1].trace.prevTxInput,
                        ),
                    );
                },
            });

        const signedPsbtHex = await testSigner.signPsbt(psbt.toHex(), psbt.psbtOptions());
        psbt.combine(ExtPsbt.fromHex(signedPsbtHex));

        expect(() => psbt.finalizeAllInputs()).to.throw(
            'Failed to finalize input 0: Execution failed, Error: Execution failed',
        );
    });
});
