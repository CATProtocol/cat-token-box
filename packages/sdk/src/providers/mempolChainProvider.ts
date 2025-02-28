import { SupportedNetwork } from '../lib/constants';
import { ChainProvider } from '../lib/provider';
import fetch from 'cross-fetch';

export class MempolChainProvider implements ChainProvider {
    private broadcastedTxs: Map<string, string> = new Map();

    constructor(public readonly network: SupportedNetwork) {}
    async getConfirmations(txId: string): Promise<number> {
        const res = await this._getConfirmations(txId);
        if (res instanceof Error) {
            throw new Error(`getConfirmations failed, ${res.message}`);
        }

        return res.confirmations;
    }

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

    private async _broadcast(txHex: string): Promise<string | Error> {
        const url = `${this.getMempoolApiHost()}/api/tx`;
        return fetch(url, {
            method: 'POST',
            body: txHex,
        })
            .then(async (res) => {
                const contentType = res.headers.get('content-type');
                if (contentType.includes('json')) {
                    return res.json();
                } else {
                    return res.text();
                }
            })
            .then(async (data) => {
                if (typeof data === 'string' && data.length === 64) {
                    return data;
                } else if (typeof data === 'object') {
                    throw new Error(JSON.stringify(data));
                } else if (typeof data === 'string') {
                    throw new Error(data);
                } else {
                    throw new Error('unknow error');
                }
            })
            .catch((e) => {
                return e;
            });
    }

    private async _getConfirmations(txid: string): Promise<
        | {
              blockhash: string;
              confirmations: number;
          }
        | Error
    > {
        const url = `${this.getMempoolApiHost()}/api/tx/${txid}/status`;
        return fetch(url, {})
            .then(async (res) => {
                const contentType = res.headers.get('content-type');
                if (contentType.includes('json')) {
                    return res.json();
                } else {
                    return res.text();
                }
            })
            .then(async (data) => {
                if (typeof data === 'object') {
                    return {
                        blockhash: data['block_hash'],
                        confirmations: data['confirmed'] ? 1 : -1,
                    };
                } else if (typeof data === 'string') {
                    throw new Error(data);
                } else {
                    throw new Error('unknow error');
                }
            })
            .catch((e) => {
                return e;
            });
    }

    async broadcast(txHex: string): Promise<string> {
        const res = await this._broadcast(txHex);
        if (res instanceof Error) {
            throw res;
        }
        this.broadcastedTxs.set(res, txHex);
        return res;
    }

    async getRawTransaction(txId: string): Promise<string> {
        let txHex = this.broadcastedTxs.get(txId);
        if (!txHex) {
            const res = await this._getRawTransaction(txId);

            if (res instanceof Error) {
                throw new Error(
                    `Can not find the tx with id ${txId}, please broadcast it by using the TestProvider first`,
                );
            }
            txHex = res;
        }
        return txHex;
    }

    private async _getRawTransaction(txid: string): Promise<string | Error> {
        const url = `${this.getMempoolApiHost()}/api/tx/${txid}/hex`;
        return (
            fetch(url, {})
                .then((res) => {
                    if (res.status !== 200) {
                        throw new Error(`invalid http response code: ${res.status}`);
                    }
                    return res.text();
                })
                .then((txhex: string) => {
                    return txhex;
                })
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                .catch((e: Error) => {
                    return e;
                })
        );
    }
}
