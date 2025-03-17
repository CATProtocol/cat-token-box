import { LEAF_VERSION_TAPSCRIPT } from '@scrypt-inc/bitcoinjs-lib';
import {
    StatefulCovenant,
    ByteString,
    SupportedNetwork,
    UTXO,
    fill,
    Ripemd160,
    getBackTraceInfo_,
    FixedArray,
    ExtPsbt,
    hexToUint8Array,
    Int32,
    PubKey,
    Sig,
    satoshiToHex,
    uint8ArrayToHex,
} from '@scrypt-inc/scrypt-ts-btc';
import { getCatCommitScript } from '../lib/commit';
import { Postage } from '../lib/constants';
import { OpenMinterCat20Meta, scaleUpAmounts } from '../lib/metadata';
import { outpoint2ByteString, isP2TR, scriptToP2tr, toTokenAddress, pubKeyPrefix, catToXOnly } from '../lib/utils';
import { CAT20Covenant } from './cat20Covenant';
import { CAT20OpenMinterState } from '../contracts';
import { CAT20OpenMinter } from '../contracts/cat20/minters/cat20OpenMinter';

export class CAT20OpenMinterCovenant extends StatefulCovenant<CAT20OpenMinterState> {
    // locked OpenMinter artifact md5
    static readonly LOCKED_ASM_VERSION = 'a989365de2bb63e67f4208497806151a';

    readonly tokenScript: ByteString;

    constructor(
        readonly tokenId: string,
        metadata: OpenMinterCat20Meta,
        state?: CAT20OpenMinterState,
        network?: SupportedNetwork,
    ) {
        const scaledTokenInfo = scaleUpAmounts(metadata);
        const maxCount = scaledTokenInfo.max / scaledTokenInfo.limit;
        const premineCount = scaledTokenInfo.premine / scaledTokenInfo.limit;
        if (premineCount > 0 && !metadata.preminerAddr) {
            throw new Error('Preminer public key is required for premining');
        }
        const contract = new CAT20OpenMinter(
            outpoint2ByteString(tokenId),
            maxCount,
            scaledTokenInfo.premine,
            premineCount,
            scaledTokenInfo.limit,
            metadata.preminerAddr || '',
        );
        super(state, [{ contract }], { network });
        this.tokenScript = new CAT20Covenant(this.address).lockingScriptHex;
    }

    static buildCommitTx(
        info: OpenMinterCat20Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
        totalOutputsAmount: number,
        changeAddress: string,
        feeRate: number,
    ): ExtPsbt {
        const commitScript = getCatCommitScript(catToXOnly(pubkey, isP2TR(address)), info);
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
        commitTxPsbt.calculateInputCtxs();
        return commitTxPsbt;
    }

    static buildRevealTx(
        commitUtxo: UTXO,
        metadata: OpenMinterCat20Meta,
        address: string,
        pubkey: string,
        feeUtxos: UTXO[],
    ): {
        tokenId: string;
        minterAddr: string;
        tokenAddr: string;
        revealPsbt: ExtPsbt;
    } {
        const scaledTokenInfo = scaleUpAmounts(metadata);
        const maxCount = scaledTokenInfo.max / scaledTokenInfo.limit;
        const premineCount = scaledTokenInfo.premine / scaledTokenInfo.limit;
        const remainingSupplyCount = maxCount - premineCount;

        if (!metadata.preminerAddr && premineCount > 0) {
            metadata.preminerAddr = Ripemd160(toTokenAddress(address));
        }

        const minter = new CAT20OpenMinterCovenant(`${commitUtxo.txId}_0`, metadata);

        const token = new CAT20Covenant(minter.address);

        minter.state = {
            tokenScript: token.lockingScriptHex,
            hasMintedBefore: false,
            remainingCount: remainingSupplyCount,
        };

        const commitScript = getCatCommitScript(catToXOnly(pubkey, isP2TR(address)), metadata);
        const commitLockingScript = Buffer.from(commitScript, 'hex');
        const { cblock } = scriptToP2tr(commitLockingScript);

        const revealTx = new ExtPsbt()
            .addCovenantOutput(minter, Postage.MINTER_POSTAGE)
            .addInput({
                hash: commitUtxo.txId,
                index: 0,
                witnessUtxo: {
                    script: hexToUint8Array(commitUtxo.script),
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
                    const sig = self.getSig(inputIdx, {
                        address: address,
                        disableTweakSigner: isP2TR(address) ? false : true,
                    });
                    const witness = [...self.getTxoStateHashes(), sig, uint8ArrayToHex(commitLockingScript), cblock];
                    return witness.map(hexToUint8Array);
                },
            })
            .spendUTXO(feeUtxos);
        // NOTE: can not have a fee change output here due to the protocol
        revealTx.calculateInputCtxs();
        return {
            tokenId: `${commitUtxo.txId}_0`,
            minterAddr: minter.address,
            tokenAddr: token.address,
            revealPsbt: revealTx,
        };
    }

    static getSplitAmountList(preRemainingSupply: Int32, isPremined: boolean, premineAmount: bigint) {
        let nextSupply = preRemainingSupply - 1n;
        if (!isPremined && premineAmount > 0n) {
            nextSupply = preRemainingSupply;
        }
        const splitAmount = fill(nextSupply / 2n, 2);
        splitAmount[0] += nextSupply - splitAmount[0] * 2n;
        return splitAmount;
    }

    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinter: CAT20OpenMinterCovenant,
        tokenReceiver: Ripemd160,
        feeUtxos: UTXO[],
        feeRate: number,
        changeAddress: string,
        estimatedVSize?: number,
        preminterAddress?: string,
        preminerPubKey?: string,
    ) {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }

        const isPremining =
            !spentMinter.state.hasMintedBefore && (spentMinter.getSubContract() as CAT20OpenMinter).premine > 0;

        if (isPremining && !preminerPubKey) {
            throw new Error('Preminer info is required for premining');
        }

        const mintTx = new ExtPsbt();

        const { nextMinters, splitAmountList } = spentMinter.createNextMinters();
        // add next minters outputs
        for (const nextMinter of nextMinters) {
            mintTx.addCovenantOutput(nextMinter, Postage.MINTER_POSTAGE);
        }

        const token = spentMinter.createToken(tokenReceiver);

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

        const backTraceInfo = getBackTraceInfo_(spentMinterTxHex, spentMinterPreTxHex, minterInputIndex);

        mintTx.updateCovenantInput(minterInputIndex, spentMinter, {
            invokeMethod: (contract: CAT20OpenMinter, curPsbt: ExtPsbt) => {
                contract.mint(
                    token.state,
                    splitAmountList,
                    isPremining ? (isP2TR(preminterAddress) ? '' : pubKeyPrefix(preminerPubKey)) : '',
                    (isPremining ? catToXOnly(preminerPubKey, isP2TR(preminterAddress)) : '') as PubKey,
                    (isPremining ? curPsbt.getSig(minterInputIndex, { publicKey: preminerPubKey }) : '') as Sig,
                    satoshiToHex(BigInt(Postage.MINTER_POSTAGE)),
                    satoshiToHex(BigInt(Postage.TOKEN_POSTAGE)),
                    backTraceInfo,
                );
            },
        });
        mintTx.calculateInputCtxs();
        return mintTx;
    }

    // static fromMintTx(
    //     tokenId: string,
    //     info: OpenMinterCat20Meta,
    //     txHex: string,
    //     outputIndex?: number,
    // ): OpenMinterCovenant {
    //     const tx = Transaction.fromHex(txHex);

    //     const minterOutputIndex = outputIndex || 1;
    //     const minterOutput = tx.outs[minterOutputIndex];
    //     if (!minterOutput) {
    //         throw new Error(`Output[${minterOutputIndex}] not found in transaction`);
    //     }

    //     const minter = new OpenMinterCovenant(tokenId, info).bindToUtxo({
    //         txId: tx.getId(),
    //         outputIndex: minterOutputIndex,
    //         satoshis: Postage.MINTER_POSTAGE,
    //     });

    //     if (Buffer.from(minterOutput.script).toString('hex') !== minter.lockingScriptHex) {
    //         throw new Error(`Invalid minter script in outputs[${outputIndex}]`);
    //     }

    //     const minterInputIndex = 0;
    //     const minterInput = tx.ins[minterInputIndex];

    //     try {
    //         const minterCounts = minter.getSubContractCallArg(
    //             minterInput.witness.map((w) => Buffer.from(w)),
    //             'mint',
    //             'nextMinterCounts',
    //         ) as FixedArray<int32, typeof MAX_NEXT_MINTERS>;

    //         // minter.state = OpenMinterProto.create(minter.tokenScript, true, minterCounts[minterOutputIndex - 1]);
    //         minter.state = {
    //             tokenScript: minter.tokenScript,
    //             hasMintedBefore: true,
    //             remainingCount: minterCounts[minterOutputIndex - 1],
    //         };
    //     } catch (error) {
    //         throw new Error(
    //             `Input[${minterInputIndex}] is not a valid minter input, or the transaction is not a mint transaction`,
    //         );
    //     }

    //     return minter;
    // }

    private createNextMinters(): {
        nextMinters: CAT20OpenMinterCovenant[];
        splitAmountList: FixedArray<Int32, 2>;
    } {
        const contract = this.getSubContract() as CAT20OpenMinter;
        const splitAmountList = CAT20OpenMinterCovenant.getSplitAmountList(
            this.state!.remainingCount,
            this.state!.hasMintedBefore,
            contract.premine,
        );

        const nextMinters = splitAmountList
            .map((amount) => {
                if (amount > 0n) {
                    const newState: CAT20OpenMinterState = {
                        tokenScript: this.tokenScript,
                        hasMintedBefore: true,
                        remainingCount: amount,
                    };
                    return this.next(newState);
                }
                return undefined;
            })
            .filter((minter) => minter !== undefined) as CAT20OpenMinterCovenant[];

        return {
            nextMinters,
            splitAmountList,
        };
    }

    private createToken(toAddr: Ripemd160): CAT20Covenant {
        const contract = this.getSubContract() as CAT20OpenMinter;
        let amount = contract.limit;
        let receiverAddr = toAddr;
        if (!this.state.hasMintedBefore && contract.premine > 0n) {
            amount = contract.premine;
            receiverAddr = contract.preminerAddr as Ripemd160;
        }
        return new CAT20Covenant(this.address, { amount, ownerAddr: receiverAddr });
    }
}
