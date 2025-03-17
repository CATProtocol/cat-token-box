import {
    bigintToByteString,
    ByteString,
    ExtPsbt,
    getBackTraceInfo_,
    hexToUint8Array,
    PubKey,
    StatefulCovenant,
    UTXO,
} from '@scrypt-inc/scrypt-ts-btc';
import { LEAF_VERSION_TAPSCRIPT } from '@scrypt-inc/bitcoinjs-lib';
import {
    CAT20ClosedMinter,
    CAT20ClosedMinterState,
    CAT20Covenant,
    ClosedMinterCat20Meta,
    // getBackTraceInfo_,
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

export class CAT20ClosedMinterCovenant extends StatefulCovenant<CAT20ClosedMinterState> {
    readonly tokenScript: ByteString;

    constructor(
        readonly issuerAddress: string,
        readonly tokenId: string,
        state?: CAT20ClosedMinterState,
        network?: SupportedNetwork,
    ) {
        const contract = new CAT20ClosedMinter(toTokenAddress(issuerAddress), outpoint2ByteString(tokenId));
        super(state, [{ contract }], {
            network,
        });
        this.tokenScript = new CAT20Covenant(this.address).lockingScriptHex;
    }

    static buildCommitTx(
        info: ClosedMinterCat20Meta,
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
            .change(changeAddress, feeRate);
        return commitTxPsbt;
    }

    static buildRevealTx(
        commitUtxo: UTXO,
        metadata: ClosedMinterCat20Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
    ): {
        tokenId: string;
        minterAddr: string;
        tokenAddr: string;
        revealPsbt: ExtPsbt;
    } {
        const initMinter = new CAT20ClosedMinterCovenant(address, `${commitUtxo.txId}_0`);

        const token = new CAT20Covenant(initMinter.address);

        const minter = initMinter.next({ tokenScript: token.lockingScriptHex });

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
            .addCovenantOutput(minter, Postage.MINTER_POSTAGE);

        // NOTE: can not have a fee change output here due to the protocol
        return {
            tokenId: `${commitUtxo.txId}_0`,
            minterAddr: initMinter.address,
            tokenAddr: token.address,
            revealPsbt: revealTx,
        };
    }

    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinter: CAT20ClosedMinterCovenant,
        tokenReceiver: ByteString,
        tokenAmount: bigint,
        feeUtxos: UTXO[],
        feeRate: number,
        changeAddress: string,
        address: string,
        pubKey: string,
        estimatedVSize?: number,
    ) {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }

        const mintTx = new ExtPsbt();
        // add next minters outputs
        mintTx.addCovenantOutput(spentMinter, Postage.MINTER_POSTAGE);
        const token = spentMinter.createCAT20(tokenReceiver, tokenAmount);

        mintTx
            // add token output
            .addCovenantOutput(token, Postage.TOKEN_POSTAGE)
            // add minter input
            .addCovenantInput(spentMinter)
            // add fees
            .spendUTXO(feeUtxos)
            // add change output
            .change(changeAddress, feeRate, estimatedVSize);

        const minterInputIndex = 0;
        const tokenState = token.state!;
        const backTraceInfo = getBackTraceInfo_(spentMinterTxHex, spentMinterPreTxHex, minterInputIndex);

        mintTx.updateCovenantInput(minterInputIndex, spentMinter, {
            invokeMethod: (contract: CAT20ClosedMinter, curPsbt) => {
                const sig = curPsbt.getSig(0, { address: address });
                contract.mint(
                    tokenState,
                    isP2TR(address) ? '' : pubKeyPrefix(pubKey),
                    PubKey(toXOnly(pubKey, isP2TR(address))),
                    sig,
                    bigintToByteString(BigInt(Postage.MINTER_POSTAGE), 8n),
                    bigintToByteString(BigInt(Postage.TOKEN_POSTAGE), 8n),
                    backTraceInfo,
                );
            },
        });

        return mintTx;
    }

    private createCAT20(toAddr: ByteString, toAmount: bigint): CAT20Covenant {
        return new CAT20Covenant(this.address, {
            ownerAddr: toAddr,
            amount: toAmount,
        });
    }
}
