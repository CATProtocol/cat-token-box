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
import { Cat20Metadata, CAT20OpenMinterState, CAT20State, Cat20TokenInfo } from '..';

export interface CAT20Utxo extends StatefulCovenantUtxo {
    state: CAT20State;
}

export interface CAT20OpenMinterUtxo extends StatefulCovenantUtxo {
    state: CAT20OpenMinterState;
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

export async function processCatPsbts(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: SwapChainProvider,
    extPsbts: ExtPsbt[],
    broadcast: boolean = true,
): Promise<Transaction[]> {
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
    // combine
    for (let index = 0; index < extPsbts.length; index++) {
        const signedPsbtHex = signedPsbtHexs[index];
        const signedCatPsbt = extPsbts[index].combine(ExtPsbt.fromHex(signedPsbtHex)).finalizeAllInputs();
        txs.push(signedCatPsbt.extractTransaction());
    }
    // boradcast
    if (broadcast) {
        for (let index = 0; index < txs.length; index++) {
            const tx = txs[index];
            await chainProvider.broadcast(tx.toHex());
            markSpent(utxoProvider, tx);
        }
    }
    return txs;
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
