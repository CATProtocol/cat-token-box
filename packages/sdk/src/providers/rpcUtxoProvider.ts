/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { UTXO } from 'scrypt-ts';
import { UtxoProvider } from '../lib/provider';
import fetch from 'cross-fetch';
import { RPCChainProvider } from './rpcChainProvider';
import Decimal from 'decimal.js';

function getUtxoKey(utxo: UTXO) {
    return `${utxo.txId}:${utxo.outputIndex}`;
}

export class RPCUtxoProvider extends RPCChainProvider implements UtxoProvider {
    private spentUTXOs = new Set<string>();

    private newUTXOs = new Map<string, UTXO>();

    constructor(
        public readonly url: string,
        public readonly walletName: string,
        public readonly username: string,
        public readonly password: string,
    ) {
        super(url, walletName, username, password);
    }

    async getUtxos(address: string, options?: { total?: number; maxCnt?: number }): Promise<UTXO[]> {
        const Authorization = `Basic ${Buffer.from(`${this.getRpcUser()}:${this.getRpcPassword()}`).toString(
            'base64',
        )}`;

        const utxos = await fetch(this.getRpcUrl(this.walletName), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'cat-cli',
                method: 'listunspent',
                params: [0, 9999999, [address]],
            }),
        })
            .then((res) => {
                if (res.status === 200) {
                    return res.json();
                }
                throw new Error(res.statusText);
            })
            .then((res: any) => {
                if (res.result === null) {
                    throw new Error(JSON.stringify(res));
                }

                const utxos: UTXO[] = res.result.map((item: any) => {
                    return {
                        txId: item.txid,
                        outputIndex: item.vout,
                        script: item.scriptPubKey,
                        satoshis: new Decimal(item.amount).mul(new Decimal(100000000)).toNumber(),
                    } as UTXO;
                });

                return utxos;
            })
            .catch((e: Error) => {
                console.error('listunspent error:', e);
                return [];
            });

        return utxos
            .concat(Array.from(this.newUTXOs.values()))
            .filter((utxo) => this.isUnSpent(utxo.txId, utxo.outputIndex))
            .sort((a, b) => a.satoshi - b.satoshi);
    }

    private isUnSpent(txId: string, vout: number) {
        const key = `${txId}:${vout}`;
        return !this.spentUTXOs.has(key);
    }

    markSpent(txId: string, vout: number) {
        const key = `${txId}:${vout}`;
        if (this.newUTXOs.has(key)) {
            this.newUTXOs.delete(key);
        }
        this.spentUTXOs.add(key);
    }
    addNewUTXO(utxo: UTXO) {
        this.newUTXOs.set(getUtxoKey(utxo), utxo);
    }
}
