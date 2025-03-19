import {
    bigintToByteString,
    ByteString,
    ExtPsbt,
    getBackTraceInfo_,
    hexToUint8Array,
    Int32,
    PubKey,
    StatefulCovenant,
    StatefulCovenantUtxo,
    UTXO,
} from '@scrypt-inc/scrypt-ts-btc';
import { LEAF_VERSION_TAPSCRIPT } from '@scrypt-inc/bitcoinjs-lib';
import {
    ClosedMinterCat721Meta,
    getCatCommitScript,
    isP2TR,
    outpoint2ByteString,
    Postage,
    pubKeyPrefix,
    scriptToP2tr,
    SupportedNetwork,
    toTokenAddress,
    toXOnly,
} from '../../../src';
import { CAT721ClosedMinterState } from '../../../src/contracts/cat721/types';
import { CAT721ClosedMinter } from '../../../src/contracts/cat721/minters/cat721ClosedMinter';
import { CAT721Covenant } from '../../../src/covenants/cat721Covenant';
import { CAT721Utxo } from 'packages/sdk/src/lib/provider';

export interface CAT721ClosedMinterUtxo extends StatefulCovenantUtxo {
    state: CAT721ClosedMinterState;
}

export class CAT721ClosedMinterCovenant extends StatefulCovenant<CAT721ClosedMinterState> {
    readonly collectionScript: ByteString;

    constructor(
        readonly issuerAddress: string,
        readonly collectionId: string,
        readonly max: Int32,
        state?: CAT721ClosedMinterState,
        network?: SupportedNetwork,
    ) {
        const contract = new CAT721ClosedMinter(toTokenAddress(issuerAddress), outpoint2ByteString(collectionId), max);
        super(state, [{ contract }], {
            network,
        });
        this.collectionScript = new CAT721Covenant(this.address).lockingScriptHex;
    }

    static buildCommitTx(
        info: ClosedMinterCat721Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
        totalOutputsAmount: number,
        changeAddress: string,
        feeRate: number,
    ): ExtPsbt {
        const commitScript = getCatCommitScript(toXOnly(pubkey, isP2TR(address)), info);
        const { p2trLockingScript } = scriptToP2tr(Buffer.from(commitScript, 'hex'));
        const commitTxPsbt = new ExtPsbt()
            .spendUTXO(feeUtxos)
            .addOutput({
                value: BigInt(Postage.METADATA_POSTAGE),
                script: hexToUint8Array(p2trLockingScript),
            })
            .addOutput({
                value: BigInt(
                    totalOutputsAmount > Postage.METADATA_POSTAGE
                        ? Math.max(546, totalOutputsAmount - Postage.METADATA_POSTAGE)
                        : 0,
                ),
                address: changeAddress,
            })
            .change(changeAddress, feeRate)
            .seal();
        return commitTxPsbt;
    }

    static buildRevealTx(
        commitUtxo: UTXO,
        metadata: ClosedMinterCat721Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
    ): {
        tokenId: string;
        minterAddr: string;
        tokenAddr: string;
        revealPsbt: ExtPsbt;
        minterUtxo: CAT721ClosedMinterUtxo;
    } {
        const initMinter = new CAT721ClosedMinterCovenant(address, `${commitUtxo.txId}_0`, metadata.max);

        const token = new CAT721Covenant(initMinter.address);

        const minter = initMinter.next({
            nftScript: token.lockingScriptHex,
            maxLocalId: metadata.max,
            nextLocalId: 0n,
        });

        const commitScript = getCatCommitScript(toXOnly(pubkey, isP2TR(address)), metadata);
        const commitLockingScript = Buffer.from(commitScript, 'hex');
        const { cblock } = scriptToP2tr(commitLockingScript);

        const revealTx = new ExtPsbt()
            .addInput({
                hash: commitUtxo.txId,
                index: 0,
                witnessUtxo: {
                    script: Buffer.from(commitUtxo.script, 'hex'),
                    value: BigInt(commitUtxo.satoshis),
                },
                // tapInternalKey: Buffer.from(TAPROOT_ONLY_SCRIPT_SPENT_KEY, 'hex'),
                tapLeafScript: [
                    {
                        leafVersion: LEAF_VERSION_TAPSCRIPT,
                        script: commitLockingScript,
                        controlBlock: Buffer.from(cblock, 'hex'),
                    },
                ],
                finalizer: (self, inputIdx) => {
                    const witness = [
                        ...self.getTxoStateHashes().map((hash) => Buffer.from(hash, 'hex')),
                        Buffer.from(
                            self.getSig(inputIdx, {
                                publicKey: pubkey,
                                disableTweakSigner: isP2TR(address) ? false : true,
                            }),
                            'hex',
                        ),
                        commitLockingScript,
                        Buffer.from(cblock, 'hex'),
                    ];
                    return witness;
                },
            })
            .spendUTXO(feeUtxos)
            .addCovenantOutput(minter, Postage.MINTER_POSTAGE)
            .seal();

        // NOTE: can not have a fee change output here due to the protocol
        return {
            tokenId: `${commitUtxo.txId}_0`,
            minterAddr: initMinter.address,
            tokenAddr: token.address,
            revealPsbt: revealTx,
            minterUtxo: {
                ...revealTx.getStatefulCovenantUtxo(1),
                state: minter.state,
            },
        };
    }

    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinter: CAT721ClosedMinterCovenant,
        nftReceiver: ByteString,
        feeUtxos: UTXO[],
        feeRate: number,
        changeAddress: string,
        address: string,
        pubKey: string,
        estimatedVSize?: number,
    ): { mintTx: ExtPsbt; minterUtxo: CAT721ClosedMinterUtxo; cat721Utxo: CAT721Utxo } {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }

        const mintTx = new ExtPsbt();

        const nft = spentMinter.createCAT721(nftReceiver, spentMinter.state.nextLocalId);

        const nextState: CAT721ClosedMinterState = {
            ...spentMinter.state,
            nextLocalId: spentMinter.state.nextLocalId + 1n,
        };

        mintTx
            // add next minters outputs
            .addCovenantOutput(spentMinter.next(nextState), Postage.MINTER_POSTAGE)
            // add token output
            .addCovenantOutput(nft, Postage.TOKEN_POSTAGE)
            // add minter input
            .addCovenantInput(spentMinter)
            // add fees
            .spendUTXO(feeUtxos)
            // add change output
            .change(changeAddress, feeRate, estimatedVSize)
            .seal();

        const minterInputIndex = 0;
        const nftState = nft.state!;
        const backTraceInfo = getBackTraceInfo_(spentMinterTxHex, spentMinterPreTxHex, minterInputIndex);

        mintTx.updateCovenantInput(minterInputIndex, spentMinter, {
            invokeMethod: (contract: CAT721ClosedMinter, curPsbt) => {
                const sig = curPsbt.getSig(0, { address: address });
                contract.mint(
                    nftState,
                    isP2TR(address) ? '' : pubKeyPrefix(pubKey),
                    PubKey(toXOnly(pubKey, isP2TR(address))),
                    sig,
                    bigintToByteString(BigInt(Postage.MINTER_POSTAGE), 8n),
                    bigintToByteString(BigInt(Postage.TOKEN_POSTAGE), 8n),
                    backTraceInfo,
                );
            },
        });

        return {
            mintTx,
            minterUtxo: {
                ...mintTx.getStatefulCovenantUtxo(1),
                state: nextState,
            },
            cat721Utxo: {
                ...mintTx.getStatefulCovenantUtxo(2),
                state: nftState,
            },
        };
    }

    private createCAT721(toAddr: ByteString, localId: bigint): CAT721Covenant {
        return new CAT721Covenant(this.address, {
            ownerAddr: toAddr,
            localId: localId,
        });
    }
}
