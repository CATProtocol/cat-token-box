import { CAT20Covenant } from '@cat-protocol/cat-sdk-v2';

import Decimal from 'decimal.js';

export function getTokenContractP2TR(minterP2TR: string) {
  return new CAT20Covenant(minterP2TR).lockingScriptHex;
}

export function scaleByDecimals(amount: bigint, decimals: number) {
  return amount * BigInt(Math.pow(10, decimals));
}

export function unScaleByDecimals(amount: bigint, decimals: number): string {
  return new Decimal(amount.toString().replace('n', ''))
    .div(Math.pow(10, decimals))
    .toFixed(decimals);
}

export function needRetry(e: Error) {
  return (
    e instanceof Error &&
    (e.message.includes('txn-mempool-conflict') ||
      e.message.includes('bad-txns-inputs-missingorspent') ||
      e.message.includes('Transaction already in block chain') ||
      e.message.includes('mempool min fee not met'))
  );
}

const INT32_MAX = 2147483647n;

export const MAX_TOTAL_SUPPLY = INT32_MAX;

export function checkTokenInfo(info: any): Error | null {
  if (typeof info.name === 'undefined') {
    return new Error(`No token name provided!`);
  }

  if (typeof info.name !== 'string') {
    return new Error(`Invalid token name!`);
  }

  if (typeof info.symbol === 'undefined') {
    return new Error(`No token symbol provided!`);
  }

  if (typeof info.symbol !== 'string') {
    return new Error(`Invalid token symbol!`);
  }

  if (typeof info.decimals === 'undefined') {
    return new Error(`No token decimals provided!`);
  }

  if (typeof info.decimals !== 'number') {
    return new Error(`Invalid token decimals!`);
  }

  if (info.decimals < 0) {
    return new Error(`decimals should >= 0!`);
  }

  if (typeof info.max === 'undefined') {
    return new Error(`No token max supply provided!`);
  }

  if (typeof info.max === 'string') {
    try {
      info.max = BigInt(info.max);
    } catch (error) {
      return error;
    }
  } else if (typeof info.max !== 'bigint') {
    return new Error(`Invalid token max supply!`);
  }

  if (typeof info.limit === 'undefined') {
    return new Error(`No token limit provided!`);
  }

  if (typeof info.limit === 'string') {
    try {
      info.limit = BigInt(info.limit);
    } catch (error) {
      return error;
    }
  } else if (typeof info.limit !== 'bigint') {
    return new Error(`Invalid token limit!`);
  }

  if (typeof info.premine === 'undefined') {
    return new Error(`No token premine provided!`);
  }

  if (typeof info.premine === 'string') {
    try {
      info.premine = BigInt(info.premine);
    } catch (error) {
      return error;
    }
  } else if (typeof info.premine !== 'bigint') {
    return new Error(`Invalid token premine!`);
  }

  if (info.max * BigInt(Math.pow(10, info.decimals)) > MAX_TOTAL_SUPPLY) {
    return new Error(`Exceeding the max supply of (2^31 - 1)!`);
  }
}
