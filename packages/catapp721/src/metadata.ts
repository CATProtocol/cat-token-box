export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  minterMd5: string;
}

const INT32_MAX = 2147483647n;

export const MAX_TOTAL_SUPPLY = INT32_MAX;

export interface ClosedMinterTokenInfo extends TokenInfo {}

export interface OpenMinterTokenInfo extends TokenInfo {
  max: bigint;
  limit: bigint;
  premine: bigint;
}

export interface TokenMetadata {
  info: TokenInfo;
  tokenId: string;
  /** token p2tr address */
  tokenAddr: string;
  /** minter p2tr address */
  minterAddr: string;
  genesisTxid: string;
  revealTxid: string;
  timestamp: number;
}

export interface CollectionMetadata {
  name: string;
  symbol: string;
  description: string;
  max: bigint;
  premine?: bigint;
  icon?: string;
  minterMd5: string;
}

export interface CollectionInfo {
  metadata: CollectionMetadata;
  collectionId: string;
  /** token p2tr address */
  collectionAddr: string;
  /** minter p2tr address */
  minterAddr: string;
  genesisTxid: string;
  revealTxid: string;
  timestamp: number;
}
