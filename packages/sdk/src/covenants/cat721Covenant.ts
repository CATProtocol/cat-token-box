import {
    ChainProvider,
    emptyOutputByteStrings,
    fill,
    FixedArray,
    getTxId,
    Ripemd160,
    STATE_OUTPUT_COUNT_MAX,
    StatefulCovenant,
    StateHashes,
    SupportedNetwork,
    TX_INPUT_COUNT_MAX,
} from '@scrypt-inc/scrypt-ts-btc';
import { addrToP2trLockingScript } from '..';
import { CAT721Utxo } from '../lib/provider';
import { Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { CAT721State } from '../contracts/cat721/types';
import { CAT721 } from '../contracts/cat721/cat721';
import { CAT721GuardCovenant } from './cat721GuardCovenant';
import { CAT721Guard } from '../contracts/cat721/cat721Guard';

interface TraceableCat721Utxo extends CAT721Utxo {
    minterAddr: string;
}

export type InputTrace = {
    prevTxHex: string;
    prevTxInput: number;
    prevTxState: StateHashes;
    prevPrevTxHex: string;
};

export type TracedCAT721Nft = {
    nft: CAT721Covenant;
    trace: InputTrace;
};

export class CAT721Covenant extends StatefulCovenant<CAT721State> {
    constructor(readonly minterAddr: string, state?: CAT721State, network?: SupportedNetwork) {
        const cat721 = new CAT721(addrToP2trLockingScript(minterAddr), new CAT721GuardCovenant().lockingScriptHex);
        super(
            state,
            [
                {
                    contract: cat721,
                },
            ],
            {
                network,
            },
        );
    }

    get minterScriptHex(): string {
        return addrToP2trLockingScript(this.minterAddr);
    }

    static createTransferGuard(
        inputInfos: {
            nft: CAT721Covenant;
            inputIndex: number;
        }[],
        receivers: {
            address: Ripemd160;
            outputIndex: number;
        }[],
    ): {
        guard: CAT721GuardCovenant;
        outputNfts: FixedArray<CAT721Covenant | undefined, typeof STATE_OUTPUT_COUNT_MAX>;
        changeOutputIndex?: number;
    } {
        if (inputInfos.length === 0) {
            throw new Error('No spent nfts');
        }

        if (inputInfos.length > TX_INPUT_COUNT_MAX - 1) {
            throw new Error(`Too many nft inputs that exceed the maximum limit of ${TX_INPUT_COUNT_MAX}`);
        }

        const minterAddr = inputInfos[0].nft.minterAddr;
        const guardState = CAT721Guard.createEmptyState();
        guardState.nftScripts[0] = inputInfos[0].nft.lockingScriptHex;
        for (let index = 0; index < inputInfos.length; index++) {
            guardState.nftScriptIndexes[index] = 0n;
            guardState.inputStateHashes[index] = CAT721.stateHash(inputInfos[index].nft.state);
        }
        const guard = new CAT721GuardCovenant(guardState);

        const outputNfts = emptyOutputByteStrings().map((_, index) => {
            const receiver = receivers.find((r) => r.outputIndex === index + 1);
            if (receiver) {
                return new CAT721Covenant(minterAddr, {
                    localId: inputInfos[index].nft.state.localId,
                    ownerAddr: receiver.address,
                });
            } else {
                return undefined;
            }
        }) as FixedArray<CAT721Covenant | undefined, typeof STATE_OUTPUT_COUNT_MAX>;

        return {
            guard,
            outputNfts: outputNfts,
        };
    }

    static createBurnGuard(
        inputInfos: {
            nft: CAT721Covenant;
            inputIndex: number;
        }[],
    ): {
        guard: CAT721GuardCovenant;
        outputNfts: FixedArray<CAT721Covenant | undefined, typeof STATE_OUTPUT_COUNT_MAX>;
        changeOutputIndex?: number;
    } {
        if (inputInfos.length === 0) {
            throw new Error('No spent nfts');
        }
        if (inputInfos.length > TX_INPUT_COUNT_MAX - 1) {
            throw new Error(`Too many nft inputs that exceed the maximum limit of ${TX_INPUT_COUNT_MAX}`);
        }
        const guardState = CAT721Guard.createEmptyState();
        guardState.nftScripts[0] = inputInfos[0].nft.lockingScriptHex;
        for (let index = 0; index < inputInfos.length; index++) {
            guardState.nftScriptIndexes[index] = 0n;
            guardState.inputStateHashes[index] = CAT721.stateHash(inputInfos[index].nft.state);
            guardState.nftBurnMasks[index] = true;
        }
        const guard = new CAT721GuardCovenant(guardState);

        const outputNfts = fill(undefined, STATE_OUTPUT_COUNT_MAX);
        return {
            guard,
            outputNfts: outputNfts,
        };
    }

    static async backtrace(
        cat721Utxos: TraceableCat721Utxo[],
        chainProvider: ChainProvider,
    ): Promise<TracedCAT721Nft[]> {
        const result: TracedCAT721Nft[] = [];

        const txCache = new Map<string, string>();
        const getRawTx = async (txId: string) => {
            let rawTxHex = txCache.get(txId);
            if (!rawTxHex) {
                rawTxHex = await chainProvider.getRawTransaction(txId);
                txCache.set(txId, rawTxHex);
            }
            return rawTxHex;
        };

        for (const cat721Utxo of cat721Utxos) {
            const nft = new CAT721Covenant(cat721Utxo.minterAddr, cat721Utxo.state).bindToUtxo(cat721Utxo);
            if (cat721Utxo.script !== nft.lockingScriptHex) {
                throw new Error(
                    `Token utxo ${JSON.stringify(cat721Utxo)} does not match the token minter address ${
                        cat721Utxo.minterAddr
                    }`,
                );
            }

            const nftTxId = cat721Utxo.txId;

            const nftTxHex = await getRawTx(nftTxId);
            const nftTx = Transaction.fromHex(nftTxHex);

            let nftPrevTxHex = undefined;
            let nftTxInputIndex = undefined;
            for (let idx = 0; idx < nftTx.ins.length; idx++) {
                const input = nftTx.ins[idx];
                const prevTxId = getTxId(input);
                const prevTxHex = await getRawTx(prevTxId);
                const prevTx = Transaction.fromHex(prevTxHex);
                const out = prevTx.outs[input.index];
                const outScript = Buffer.from(out.script).toString('hex');
                if (outScript === cat721Utxo.script || outScript === nft.minterScriptHex) {
                    nftPrevTxHex = prevTxHex;
                    nftTxInputIndex = idx;
                    break;
                }
            }

            if (!nftPrevTxHex || nftTxInputIndex === undefined) {
                throw new Error(`Token utxo ${JSON.stringify(cat721Utxo)} can not be backtraced`);
            }

            result.push({
                nft,
                trace: {
                    prevTxHex: nftTxHex,
                    prevTxState: cat721Utxo.txoStateHashes,
                    prevTxInput: nftTxInputIndex,
                    prevPrevTxHex: nftPrevTxHex,
                },
            });
        }

        return result;
    }
}
