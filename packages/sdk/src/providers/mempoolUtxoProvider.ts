/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { UTXO } from 'scrypt-ts';
import { UtxoProvider } from '../lib/provider';
import { bitcoinjs } from '../lib/btc';
import { SupportedNetwork } from '../lib/constants';
import fetch from 'cross-fetch';

function getUtxoKey(utxo: UTXO) {
    return `${utxo.txId}:${utxo.outputIndex}`;
}

export class MempoolUtxoProvider implements UtxoProvider {
    private spentUTXOs = new Set<string>();

    private newUTXOs = new Map<string, UTXO>();

    constructor(public readonly network: SupportedNetwork) {}

    getMempoolApiHost = () => {
        if (this.network === 'btc-signet') {
            return 'https://mempool.space/signet';
        } else if (this.network === 'fractal-testnet') {
            return 'https://mempool-testnet.fractalbitcoin.io';
        } else if (this.network === 'fractal-mainnet') {
            return 'https://mempool.fractalbitcoin.io';
        } else {
            throw new Error(`Unsupport network: ${this.network}`);
        }
    };

    async getUtxos(address: string, options?: { total?: number; maxCnt?: number }): Promise<UTXO[]> {
        const script = Buffer.from(bitcoinjs.address.toOutputScript(address)).toString('hex');

        const url = `${this.getMempoolApiHost()}/api/address/${address}/utxo`;

        const utxos: Array<any> = await fetch(url)
            .then(async (res) => {
                const contentType = res.headers.get('content-type');
                if (contentType.includes('json')) {
                    return res.json();
                } else {
                    throw new Error(`invalid http content type : ${contentType}, status: ${res.status}`);
                }
            })
            .then((utxos: Array<any>) =>
                utxos.map((utxo) => {
                    return {
                        txId: utxo.txid,
                        outputIndex: utxo.vout,
                        script: utxo.script || script,
                        satoshis: utxo.value,
                    };
                }),
            )
            .catch((e) => {
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
