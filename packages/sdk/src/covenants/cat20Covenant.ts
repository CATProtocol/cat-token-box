import {
    ByteString,
    ChainProvider,
    fill,
    FixedArray,
    Int32,
    STATE_OUTPUT_COUNT_MAX,
    StatefulCovenant,
    StateHashes,
    SupportedNetwork,
    TX_INPUT_COUNT_MAX,
} from '@scrypt-inc/scrypt-ts-btc';
import { addrToP2trLockingScript, CAT20, CAT20Guard, CAT20State, emptyOutputByteStrings, getTxId } from '..';
import { CAT20GuardCovenant } from './cat20GuardCovenant';
import { CAT20Utxo } from '../lib/provider';
import { Transaction } from '@scrypt-inc/bitcoinjs-lib';

interface TraceableCat20Utxo extends CAT20Utxo {
    minterAddr: string;
}

export type InputTrace = {
    prevTxHex: string;
    prevTxInput: number;
    prevTxState: StateHashes;
    prevPrevTxHex: string;
};

export type TracedCAT20Token = {
    token: CAT20Covenant;
    trace: InputTrace;
};

export class CAT20Covenant extends StatefulCovenant<CAT20State> {
    constructor(readonly minterAddr: string, state?: CAT20State, network?: SupportedNetwork) {
        const cat20 = new CAT20(addrToP2trLockingScript(minterAddr), new CAT20GuardCovenant().lockingScriptHex);
        super(
            state,
            [
                {
                    contract: cat20,
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
            token: CAT20Covenant;
            inputIndex: number;
        }[],
        receivers: {
            address: ByteString;
            amount: Int32;
            outputIndex: number;
        }[],
        changeInfo?: {
            address: ByteString;
        },
    ): {
        guard: CAT20GuardCovenant;
        outputTokens: FixedArray<CAT20Covenant | undefined, typeof STATE_OUTPUT_COUNT_MAX>;
        changeTokenOutputIndex: number;
    } {
        if (inputInfos.length === 0) {
            throw new Error('No spent tokens');
        }

        if (inputInfos.length > TX_INPUT_COUNT_MAX - 1) {
            throw new Error(`Too many token inputs that exceed the maximum limit of ${TX_INPUT_COUNT_MAX}`);
        }

        const totalTokenInputAmount = inputInfos.reduce((acc, info) => {
            if (!info.token.state) {
                throw new Error('Token state is missing');
            }
            return acc + info.token.state.amount;
        }, 0n);

        const totalTokenOutputAmount = receivers.reduce((acc, receiver) => acc + receiver.amount, 0n);

        if (totalTokenInputAmount < totalTokenOutputAmount) {
            throw new Error('Insufficient token input amount');
        }

        if (totalTokenInputAmount > totalTokenOutputAmount && !changeInfo) {
            throw new Error('Unbalanced token output amount, change address is missing');
        }

        const changeTokenAmount = totalTokenInputAmount - totalTokenOutputAmount;
        let changeTokenOutputIndex = -1;
        if (changeTokenAmount > 0) {
            changeTokenOutputIndex = receivers.length + 1;
        }

        const minterAddr = inputInfos[0].token.minterAddr;
        const guardState = CAT20Guard.createEmptyState();
        guardState.tokenScripts[0] = inputInfos[0].token.lockingScriptHex;
        for (let index = 0; index < inputInfos.length; index++) {
            guardState.tokenScriptIndexes[index] = 0n;
            guardState.inputStateHashes[index] = CAT20.stateHash(inputInfos[index].token.state);
        }
        guardState.tokenAmounts[0] = inputInfos.reduce((p, c) => p + c.token.state.amount, 0n);
        const guard = new CAT20GuardCovenant(guardState);
        const outputTokens = emptyOutputByteStrings().map((_, index) => {
            const receiver = receivers.find((r) => r.outputIndex === index + 1);
            if (receiver) {
                if (receiver.amount <= 0) {
                    throw new Error(`Invalid token amount ${receiver.amount} for output ${index + 1}`);
                }
                return new CAT20Covenant(minterAddr, { amount: receiver.amount, ownerAddr: receiver.address });
            } else if (changeTokenAmount > 0 && index + 1 === changeTokenOutputIndex) {
                return new CAT20Covenant(minterAddr, { amount: changeTokenAmount, ownerAddr: changeInfo.address });
            } else {
                return undefined;
            }
        }) as FixedArray<CAT20Covenant | undefined, typeof STATE_OUTPUT_COUNT_MAX>;

        return {
            guard,
            outputTokens,
            changeTokenOutputIndex,
        };
    }

    static createBurnGuard(
        inputInfos: {
            token: CAT20Covenant;
            inputIndex: number;
        }[],
    ): {
        guard: CAT20GuardCovenant;
        outputTokens: FixedArray<CAT20Covenant | undefined, typeof STATE_OUTPUT_COUNT_MAX>;
        changeOutputIndex?: number;
    } {
        if (inputInfos.length === 0) {
            throw new Error('No spent tokens');
        }
        if (inputInfos.length > TX_INPUT_COUNT_MAX - 1) {
            throw new Error(`Too many token inputs that exceed the maximum limit of ${TX_INPUT_COUNT_MAX}`);
        }
        const guardState = CAT20Guard.createEmptyState();
        guardState.tokenScripts[0] = inputInfos[0].token.lockingScriptHex;
        for (let index = 0; index < inputInfos.length; index++) {
            guardState.tokenScriptIndexes[index] = 0n;
            guardState.inputStateHashes[index] = CAT20.stateHash(inputInfos[index].token.state);
        }
        guardState.tokenAmounts[0] = inputInfos.reduce((p, c) => p + c.token.state.amount, 0n);
        const guard = new CAT20GuardCovenant(guardState);
        const outputTokens = fill(undefined, STATE_OUTPUT_COUNT_MAX);
        return {
            guard,
            outputTokens,
        };
    }

    static async backtrace(
        cat20Utxos: TraceableCat20Utxo[],
        chainProvider: ChainProvider,
    ): Promise<TracedCAT20Token[]> {
        const result: TracedCAT20Token[] = [];

        const txCache = new Map<string, string>();
        const getRawTx = async (txId: string) => {
            let rawTxHex = txCache.get(txId);
            if (!rawTxHex) {
                rawTxHex = await chainProvider.getRawTransaction(txId);
                txCache.set(txId, rawTxHex);
            }
            return rawTxHex;
        };

        for (const cat20Utxo of cat20Utxos) {
            const token = new CAT20Covenant(cat20Utxo.minterAddr, cat20Utxo.state).bindToUtxo(cat20Utxo);
            if (cat20Utxo.script !== token.lockingScriptHex) {
                throw new Error(
                    `Token utxo ${JSON.stringify(cat20Utxo)} does not match the token minter address ${
                        cat20Utxo.minterAddr
                    }`,
                );
            }

            const tokenTxId = cat20Utxo.txId;

            const tokenTxHex = await getRawTx(tokenTxId);
            const tokenTx = Transaction.fromHex(tokenTxHex);

            let tokenPrevTxHex = undefined;
            let tokenTxInputIndex = undefined;
            for (let idx = 0; idx < tokenTx.ins.length; idx++) {
                const input = tokenTx.ins[idx];
                const prevTxId = getTxId(input);
                const prevTxHex = await getRawTx(prevTxId);
                const prevTx = Transaction.fromHex(prevTxHex);
                const out = prevTx.outs[input.index];
                const outScript = Buffer.from(out.script).toString('hex');
                if (outScript === cat20Utxo.script || outScript === token.minterScriptHex) {
                    tokenPrevTxHex = prevTxHex;
                    tokenTxInputIndex = idx;
                    break;
                }
            }

            if (!tokenPrevTxHex || tokenTxInputIndex === undefined) {
                throw new Error(`Token utxo ${JSON.stringify(cat20Utxo)} can not be backtraced`);
            }

            result.push({
                token,
                trace: {
                    prevTxHex: tokenTxHex,
                    prevTxState: cat20Utxo.txoStateHashes,
                    prevTxInput: tokenTxInputIndex,
                    prevPrevTxHex: tokenPrevTxHex,
                },
            });
        }

        return result;
    }
}
