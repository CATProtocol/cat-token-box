import { Ripemd160 } from "scrypt-ts";

/**
 * CAT20 metadata
 */
export interface Cat20Metadata {
  /** name of the CAT20 token, required */
  name: string;
  /** symbol of the CAT20 token, required */
  symbol: string;
  /** decimals of the CAT20 token, required */
  decimals: number;
  /** md5 of the CAT20 token minter contract, required */
  minterMd5: string;
}

/**
 * CAT721 metadata
 */
export interface Cat721Metadata {
  /** name of the CAT721 collection, required */
  name: string
  /** symbol of the CAT721 collection, required */
  symbol: string
  /** description of the CAT721 collection, required */
  description: string
  /** max nfts number of the CAT721 collection, required */
  max: bigint
  /** premine nfts number of the CAT721 collection, optional */
  premine?: bigint
  /** icon of the CAT721 collection, optional */
  icon?: string
  /** md5 of the CAT721 token minter contract, required */
  minterMd5: string
}

export interface ClosedMinterCat20Meta extends Cat20Metadata { }

export interface NftParallelClosedMinterCat721Meta extends Cat721Metadata {}

export interface OpenMinterCat20Meta extends Cat20Metadata {
  max: bigint;
  limit: bigint;
  premine: bigint;
  preminerAddr?: Ripemd160;
}

export interface Cat20TokenInfo<T extends Cat20Metadata> {
  tokenId: string;
  /** token p2tr address */
  tokenAddr: string;
  /** minter p2tr address */
  minterAddr: string;
  genesisTxid: string;
  revealTxid: string;
  timestamp: number;
  metadata: T;
}

export interface Cat721NftInfo<T extends Cat721Metadata> {
  metadata: T
  collectionId: string
  /** token p2tr address */
  collectionAddr: string
  /** minter p2tr address */
  minterAddr: string
  genesisTxid: string
  revealTxid: string
}

export function scaleUpAmounts(metadata: OpenMinterCat20Meta): OpenMinterCat20Meta {
  const clone = Object.assign({}, metadata);
  clone.max = scaleUpByDecimals(metadata.max, metadata.decimals);
  clone.premine = scaleUpByDecimals(metadata.premine, metadata.decimals);
  clone.limit = scaleUpByDecimals(metadata.limit, metadata.decimals);
  return clone;
}

export function scaleUpByDecimals(amount: bigint, decimals: number) {
  return amount * BigInt(Math.pow(10, decimals));
}