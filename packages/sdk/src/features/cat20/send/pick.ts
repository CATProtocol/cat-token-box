import { UTXO } from 'scrypt-ts';
import { Cat20Utxo } from '../../../lib/provider';

/**
 * Select CAT20 UTXOs from all available CAT20 UTXOs such that the cumulative number of tokens equals the specified amount, with priority given to those containing a number of tokens greater than or equal to the amount.
 * @param tokens Cat20 UTXOs
 * @param amount the minimum required number of tokens.
 * @returns 
 */
export function pick(
  tokens: Array<Cat20Utxo>,
  amount: bigint,
): Array<Cat20Utxo> {
  let t = tokens.find((token) => {
    return token.state.amount == amount;
  });

  // if found a token utxo contains enough token amount
  if (t) {
    return [t];
  }

  t = tokens.find((token) => {
    return token.state.amount > amount;
  });

  // if found a token utxo contains enough token amount
  if (t) {
    return [t];
  }

  const acc: Array<Cat20Utxo> = [];
  let accAmount: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    accAmount += token.state.amount;
    acc.push(token);
    if (accAmount >= amount) {
      return acc;
    }
  }

  return [];
}


/**
 * Select CAT20 UTXOs in sequence from all CAT20 UTXOs such that the cumulative number of tokens equals the specified amount.
 * @param tokens Cat20 UTXOs
 * @param amount the minimum required number of tokens.
 * @returns 
 */
export function pickFromStart(
  tokens: Array<Cat20Utxo>,
  amount: bigint,
): Array<Cat20Utxo> {
  const acc: Array<Cat20Utxo> = [];
  let accAmount: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    accAmount += token.state.amount;
    acc.push(token);
    if (accAmount >= amount) {
      return acc;
    }
  }

  return [];
}

/**
 * Pick the UTXO containing the highest satoshis
 * @param utxos 
 * @returns 
 */
export function pickLargeFeeUtxo(utxos: Array<UTXO>): UTXO {
  let max = utxos[0];

  for (const utxo of utxos) {
    if (utxo.satoshis > max.satoshis) {
      max = utxo;
    }
  }
  return max;
}


/**
 * Calculate the total number of tokens contained in all CAT20 UTXOs.
 * @param tokens Cat20Utxo
 * @returns 
 */
export function calcTotalAmount(tokens: Cat20Utxo[]) {
  return tokens.reduce((acc, t) => acc + t.state.amount, 0n);
}
