import { LEAF_VERSION_TAPSCRIPT, Transaction } from '@scrypt-inc/bitcoinjs-lib';
import {
    StatefulCovenant,
    ByteString,
    SupportedNetwork,
    UTXO,
    Ripemd160,
    getBackTraceInfo,
    ExtPsbt,
    hexToUint8Array,
    Int32,
    PubKey,
    Sig,
    uint8ArrayToHex,
    StateHashes,
} from '@scrypt-inc/scrypt-ts-btc';
import {
    getCatCommitScript, 
    Postage,
    ClosedMinterCat20Meta,
    outpoint2ByteString,
    isP2TR,
    scriptToP2tr,
    pubKeyPrefix,
    catToXOnly,
    satoshiToHex,
    addrToP2trLockingScript,
    CAT20ClosedMinterUtxo,
} from '../lib/index.js';

import { CAT20Covenant } from './cat20Covenant.js';
import { CAT20ClosedMinterState, CAT20ClosedMinter} from '../contracts/index.js';

export class CAT20ClosedMinterCovenant extends StatefulCovenant<CAT20ClosedMinterState> {
    // locked OpenMinter artifact md5
    static readonly LOCKED_ASM_VERSION = 'e19abad5fe3486eae439e208f06c16e9';

    readonly tokenScript: ByteString;

    constructor(
        readonly tokenId: string,
        readonly issuerAddress: string,
        readonly metadata: ClosedMinterCat20Meta,
        state?: CAT20ClosedMinterState,
        network?: SupportedNetwork,
    ) {
        const contract = new CAT20ClosedMinter(
            addrToP2trLockingScript(issuerAddress),
            outpoint2ByteString(tokenId),
        );

        super(state, [{ contract }], { network });
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
            .change(changeAddress, feeRate)
            .seal();
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

        const minter = new CAT20ClosedMinterCovenant(`${commitUtxo.txId}_0`, address, metadata);

        const token = new CAT20Covenant(minter.address);

        minter.state = {
            tokenScript: token.lockingScriptHex,
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
            .spendUTXO(feeUtxos)
            .seal();
        // NOTE: can not have a fee change output here due to the protocol
        return {
            tokenId: `${commitUtxo.txId}_0`,
            minterAddr: minter.address,
            tokenAddr: token.address,
            revealPsbt: revealTx,
        };
    }


    static buildMintTx(
        spentMinterPreTxHex: string,
        spentMinterTxHex: string,
        spentMinter: CAT20ClosedMinterCovenant,
        tokenReceiver: Ripemd160,
        issuerAddres: string,
        issuerPubKey: string,
        amount: Int32,
        feeUtxos: UTXO[],
        feeRate: number,

        changeAddress: string,
    ) {
        if (!spentMinter.state) {
            throw new Error('Minter state is not available');
        }


        const mintTx = new ExtPsbt();

        const nextMinter = spentMinter.createNextMinter();
        // add next minters outputs
        mintTx.addCovenantOutput(nextMinter, Postage.MINTER_POSTAGE);

        const token = spentMinter.createToken(tokenReceiver, amount);

        const minterInputIndex = 0;

        const backTraceInfo = getBackTraceInfo(spentMinterTxHex, spentMinterPreTxHex, minterInputIndex);

        mintTx
            // add token output
            .addCovenantOutput(token, Postage.TOKEN_POSTAGE)
            // add minter input
            .addCovenantInput(spentMinter)
            // add fees
            .spendUTXO(feeUtxos)
            .change(changeAddress, feeRate);

        mintTx
            .updateCovenantInput(minterInputIndex, spentMinter, {
                invokeMethod: (contract: CAT20ClosedMinter, curPsbt: ExtPsbt) => {
                    contract.mint(
                        token.state,
                        (isP2TR(issuerAddres) ? '' : pubKeyPrefix(issuerPubKey)) as ByteString,
                        (catToXOnly(issuerPubKey, isP2TR(issuerAddres))) as PubKey,
                        curPsbt.getSig(minterInputIndex, { publicKey: issuerPubKey }) as Sig,
                        satoshiToHex(BigInt(Postage.MINTER_POSTAGE)),
                        satoshiToHex(BigInt(Postage.TOKEN_POSTAGE)),
                        backTraceInfo,
                    );
                },
            })
            .seal();
        return mintTx;
    }

    static utxoFromMintTx(txHex: string, outputIndex: number): CAT20ClosedMinterUtxo {
        const tx = Transaction.fromHex(txHex);
        const minterOutput = tx.outs[outputIndex];
        if (!minterOutput) {
            throw new Error(`Output[${outputIndex}] not found in transaction`);
        }
        const witness = tx.ins[0].witness;
        const witnessHexList = witness.map((v) => uint8ArrayToHex(v));
        const nextRemainingCounts = witnessHexList.slice(2, 4);
        const txoStateHashes = witnessHexList.slice(witnessHexList.length - 20 - 5, witnessHexList.length - 20);
        let tokenOutputIndex = 1n;
        for (let index = 0; index < nextRemainingCounts.length; index++) {
            if (nextRemainingCounts[index] !== '') {
                tokenOutputIndex += 1n;
            }
        }
        const tokenScript = uint8ArrayToHex(tx.outs[Number(tokenOutputIndex)].script);
        const state: CAT20ClosedMinterState = {
            tokenScript: tokenScript,
        };
        // return minter;
        const out = tx.outs[outputIndex];
        const cat20MinterUtxo: CAT20ClosedMinterUtxo = {
            txId: tx.getId(),
            outputIndex: outputIndex,
            script: uint8ArrayToHex(out.script),
            satoshis: Number(out.value),
            txHashPreimage: uint8ArrayToHex(tx.toBuffer(undefined, 0, false)),
            txoStateHashes: txoStateHashes as StateHashes,
            state: state,
        };
        return cat20MinterUtxo;
    }

    private createNextMinter(): CAT20ClosedMinterCovenant {
        const newState: CAT20ClosedMinterState = {
            tokenScript: this.tokenScript,
        };
        return this.next(newState) as CAT20ClosedMinterCovenant;
    }

    private createToken(toAddr: Ripemd160, amount: Int32): CAT20Covenant {
        return new CAT20Covenant(this.address, { amount, ownerAddr: toAddr });
    }
}
