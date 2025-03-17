import { Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { ChainProvider, UTXO, UtxoProvider } from '@scrypt-inc/scrypt-ts-btc';
import { getDummyUtxo } from '../../src';

export class TestChainProvider implements ChainProvider {
    private broadcastedTxs: Map<string, string> = new Map();

    constructor() {}

    async getFeeRate(): Promise<number> {
        return 1;
    }

    getConfirmations(): Promise<number> {
        return Promise.resolve(1);
    }

    async broadcast(txHex: string): Promise<string> {
        const tx = Transaction.fromHex(txHex);
        const txId = tx.getId();
        this.broadcastedTxs.set(txId, txHex);
        return txId;
    }

    async getRawTransaction(txId: string): Promise<string> {
        const txHex = this.broadcastedTxs.get(txId);
        if (!txHex) {
            throw new Error(`Can not find the tx with id ${txId}, please broadcast it by using the TestProvider first`);
        }
        return txHex;
    }
}

export class TestUtxoProvider implements UtxoProvider {
    constructor() {}

    markSpent(): void {}

    addNewUTXO(): void {}

    async getUtxos(address: string): Promise<UTXO[]> {
        return Promise.resolve([getDummyUtxo(address)]);
    }
}

export const testChainProvider = new TestChainProvider();
export const testUtxoProvider = new TestUtxoProvider();
