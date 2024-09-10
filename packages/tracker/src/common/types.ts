export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  max?: bigint;
  limit?: bigint;
  premine?: bigint;
  minterMd5?: string;
}

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
