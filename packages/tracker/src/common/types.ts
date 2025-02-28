export interface BlockHeader {
  hash: string;
  version: number;
  versionHex: string;
  merkleroot: string;
  time: number;
  nonce: number;
  bits: string;
  difficulty: number;
  previousblockhash: string;
  confirmations: number;
  height: number;
  mediantime: number;
  chainwork: string;
  nTx: number;
  nextblockhash: string;
}

export enum TokenTypeScope {
  Fungible,
  NonFungible,
  All,
}

export enum EnvelopeMarker {
  Token = 'OP_1',
  Collection = 'OP_2',
  NFT = 'OP_3',
}

export interface Content {
  type?: string;
  encoding?: string;
  raw?: Buffer;
}

export type CachedContent = Content & { lastModified?: Date };

export interface EnvelopeData {
  metadata?: object;
  content?: Content;
}

export interface TokenInfoEnvelope {
  marker: EnvelopeMarker;
  data: EnvelopeData;
}

export interface TaprootPayment {
  pubkey?: Buffer;
  redeemScript?: Buffer;
  witness?: Buffer[];
}
