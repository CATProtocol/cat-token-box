import { Ripemd160, UTXO } from "scrypt-ts"
import { StatefulCovenantUtxo } from "./covenant"
import { CAT20State } from "../contracts/token/cat20Proto"
import { CAT721State } from "../contracts/nft/cat721Proto"
import { OpenMinterV2State } from "../contracts/token/openMinterV2Proto"
import { OpenMinterState } from "../contracts/token/openMinterProto"
import { Transaction } from "bitcoinjs-lib"
import { getTxId } from "./utils"
import { NftParallelClosedMinterState } from "../contracts/nft/nftParallelClosedMinterProto"

export interface Cat20Utxo extends StatefulCovenantUtxo {
  state: CAT20State
}

export interface Cat721Utxo extends StatefulCovenantUtxo {
    state: CAT721State
}

export interface Cat20MinterUtxo extends StatefulCovenantUtxo {
  state: OpenMinterV2State | OpenMinterState
}


export interface Cat721MinterUtxo extends StatefulCovenantUtxo {
  state: NftParallelClosedMinterState
}



/**
 * a Provider used to query UTXO related to the address
 */
export interface UtxoProvider {
  getUtxos(address: string, options?: { total?: number, maxCnt?: number }): Promise<UTXO[]>,
  markSpent(txId: string, vout: number): void,
  addNewUTXO(utxo: UTXO): void,
}

export function markSpent(utxoProvider: UtxoProvider, tx: Transaction) {
  for (let i = 0; i < tx.ins.length; i++) {
    const input = tx.ins[i];
    utxoProvider.markSpent(getTxId(input), input.index);
  }
}

export interface Cat20UtxoProvider {
  getCat20Utxos(tokenIdOrAddr: string, ownerAddr: Ripemd160, options?: { total?: number, maxCnt?: number }): Promise<Cat20Utxo[]>
}

export interface Cat721UtxoProvider {
    getCat721Utxos(
        tokenIdOrAddr: string,
        ownerAddr: Ripemd160,
        options?: { total?: number; maxCnt?: number }
    ): Promise<Cat721Utxo[]>
}

type TxId = string

/**
 * a provider for interacting with the blockchain
 */
export interface ChainProvider {
  broadcast(txHex: string): Promise<TxId>
  getRawTransaction(txId: TxId): Promise<string>

  getConfirmations(txId: TxId): Promise<number>
}