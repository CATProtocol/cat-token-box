import {
    ChainProvider,
    ExtPsbt,
    markSpent,
    Ripemd160,
    Signer,
    StatefulCovenantUtxo,
    UtxoProvider,
} from '@scrypt-inc/scrypt-ts-btc';
import { Transaction } from '@scrypt-inc/bitcoinjs-lib';
import { CAT20State, CAT721State, CAT20OpenMinterState, CAT20ClosedMinterState, CAT721OpenMinterState } from '../contracts/index.js';
import { Cat20Metadata, Cat20TokenInfo } from './metadata.js';
import { filterFeeUtxos } from './utils.js';

export interface CAT20Utxo extends StatefulCovenantUtxo {
    state: CAT20State;
}

export interface CAT721Utxo extends StatefulCovenantUtxo {
    state: CAT721State;
}

export interface CAT20OpenMinterUtxo extends StatefulCovenantUtxo {
    state: CAT20OpenMinterState;
}

export interface CAT20ClosedMinterUtxo extends StatefulCovenantUtxo {
    state: CAT20ClosedMinterState;
}

export interface CAT721OpenMinterUtxo extends StatefulCovenantUtxo {
    state: CAT721OpenMinterState;
}

export interface Cat20UtxoProvider {
    getCat20Utxos(
        tokenIdOrAddr: string,
        ownerAddr: Ripemd160,
        options?: { total?: number; maxCnt?: number },
    ): Promise<CAT20Utxo[]>;
}

export interface TrackerProvider {
    tokenInfo<T extends Cat20Metadata>(tokenId: string): Promise<Cat20TokenInfo<T>>;

    tokens(tokenId: string, ownerAddr: string): Promise<Array<CAT20Utxo>>;
}

type TxId = string;

export interface SwapChainProvider {
    broadcast(txHex: string): Promise<TxId>;
    cacheTx(tx: Transaction);
    getRawTransaction(txId: TxId): Promise<string>;
    getConfirmations(txId: TxId): Promise<number>;
}

export async function processExtPsbts(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    extPsbts: ExtPsbt[],
    broadcast: boolean = true,
): Promise<{ txs: Transaction[]; psbts: ExtPsbt[] }> {
    // sign
    const signedPsbtHexs = await signer.signPsbts(
        extPsbts.map((catPsbt) => {
            return {
                psbtHex: catPsbt.toHex(),
                options: catPsbt.psbtOptions(),
            };
        }),
    );
    const txs: Transaction[] = [];
    const psbts: ExtPsbt[] = [];
    // combine
    for (let index = 0; index < extPsbts.length; index++) {
        const signedPsbtHex = signedPsbtHexs[index];
        const signedCatPsbt = extPsbts[index].combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        txs.push(signedCatPsbt.extractTransaction());
        psbts.push(signedCatPsbt);
    }
    // boradcast
    if (broadcast) {
        for (let index = 0; index < txs.length; index++) {
            const tx = txs[index];
            await chainProvider.broadcast(tx.toHex());
            markSpent(utxoProvider, tx);
        }
    }
    return { txs, psbts };
}

export async function providerCacheTx(chainProvider: SwapChainProvider, extPsbts: ExtPsbt[]) {
    for (let index = 0; index < extPsbts.length; index++) {
        await chainProvider.cacheTx(extPsbts[index].unsignedTx);
    }
}

export async function batchBroadcast(chainProvider: ChainProvider, txHexList: string[]) {
    for (let index = 0; index < txHexList.length; index++) {
        const txHex = txHexList[index];
        await chainProvider.broadcast(txHex);
    }
}

export const getUtxos = async function (utxoProvider: UtxoProvider, address: string, limit?: number) {
    let utxos = await utxoProvider.getUtxos(address);

    utxos = filterFeeUtxos(utxos).slice(0, limit || utxos.length);

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount');
    }
    return utxos;
};
