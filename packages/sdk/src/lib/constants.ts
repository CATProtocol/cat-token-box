export const TAPROOT_ONLY_SCRIPT_SPENT_KEY = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

export enum Postage {
    METADATA_POSTAGE = 546,
    GUARD_POSTAGE = 332,
    MINTER_POSTAGE = 331,
    TOKEN_POSTAGE = 330,
    NFT_POSTAGE = 333,
}

const INT32_MAX = 2147483647n;

export const MAX_TOTAL_SUPPLY = INT32_MAX;

export type SupportedNetwork = 'btc-signet' | 'fractal-mainnet' | 'fractal-testnet';
