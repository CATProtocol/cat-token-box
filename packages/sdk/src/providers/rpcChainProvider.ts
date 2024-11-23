/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChainProvider } from "../lib/provider";

export class RPCChainProvider implements ChainProvider {
    private broadcastedTxs: Map<string, string> = new Map();

    constructor(public readonly url: string,
        public readonly walletName: string,
        public readonly username: string,
        public readonly password: string) { }


    getRpcUser = () => {
        return this.username;
    };
    getRpcPassword = () => {
        return this.password;
    };
    getRpcUrl = (walletName: string) => {
        return walletName === null
            ? this.url
            : `${this.url}/wallet/${walletName}`;
    };


    async getConfirmations(txId: string): Promise<number> {
        const res = await this._getConfirmations(txId);
        if (res instanceof Error) {
            throw new Error(`getConfirmations failed, ${res.message}`);
        }

        return res.confirmations;
    }


    private async _broadcast(
        txHex: string,
    ): Promise<string | Error> {

        const Authorization = `Basic ${Buffer.from(
            `${this.getRpcUser()}:${this.getRpcPassword()}`,
        ).toString('base64')}`;

        return fetch(this.getRpcUrl(null), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'cat-cli',
                method: 'sendrawtransaction',
                params: [txHex],
            }),
        })
            .then((res) => {
                const contentType = res.headers.get('content-type');
                if (contentType.includes('json')) {
                    return res.json();
                } else {
                    throw new Error(
                        `invalid http content type : ${contentType}, status: ${res.status}`,
                    );
                }
            })
            .then((res: any) => {
                if (res.result === null) {
                    throw new Error(JSON.stringify(res));
                }
                return res.result;
            })
            .catch((e) => {
                console.error('sendrawtransaction error:', e);
                return e;
            });
    }



    private async _getConfirmations(
        txid: string,
    ): Promise<
        | {
            blockhash: string;
            confirmations: number;
        }
        | Error
    > {
        const Authorization = `Basic ${Buffer.from(
            `${this.getRpcUser()}:${this.getRpcPassword()}`,
        ).toString('base64')}`;

        return fetch(this.getRpcUrl(null), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'cat-cli',
                method: 'getrawtransaction',
                params: [txid, true],
            }),
        })
            .then((res) => {
                const contentType = res.headers.get('content-type');
                if (contentType.includes('json')) {
                    return res.json();
                } else {
                    throw new Error(
                        `invalid http content type : ${contentType}, status: ${res.status}`,
                    );
                }
            })
            .then((res: any) => {
                if (res.result === null) {
                    throw new Error(JSON.stringify(res));
                }
                return {
                    confirmations: -1,
                    blockhash: '',
                    ...res.result,
                };
            })
            .catch((e) => {
                console.error('getConfirmations error:', e);
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
                    `Can not find the tx with id ${txId}, please broadcast it first`,
                );
            }
            txHex = res;
        }
        return txHex;
    }


    private async _getRawTransaction(
        txid: string,
    ): Promise<string | Error> {
        const Authorization = `Basic ${Buffer.from(
            `${this.getRpcUser()}:${this.getRpcPassword()}`,
        ).toString('base64')}`;

        return fetch(this.getRpcUrl(null), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization,
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'cat-cli',
                method: 'getrawtransaction',
                params: [txid],
            }),
        })
            .then((res) => {
                const contentType = res.headers.get('content-type');
                if (contentType.includes('json')) {
                    return res.json();
                } else {
                    throw new Error(
                        `invalid http content type : ${contentType}, status: ${res.status}`,
                    );
                }
            })
            .then((res: any) => {
                if (res.result === null) {
                    throw new Error(JSON.stringify(res));
                }
                return res.result;
            })
            .catch((e) => {
                return e;
            });
    }
}