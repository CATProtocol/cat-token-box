import { TokenContract } from 'src/common';
import { UTXO } from 'scrypt-ts';

export function pick(
  tokens: Array<TokenContract>,
  amount: bigint,
): Array<TokenContract> {
  let t = tokens.find((token) => {
    return token.state.data.amount == amount;
  });

  // if found a token utxo contains enough token amount
  if (t) {
    return [t];
  }

  t = tokens.find((token) => {
    return token.state.data.amount > amount;
  });

  // if found a token utxo contains enough token amount
  if (t) {
    return [t];
  }

  const acc: Array<TokenContract> = [];
  let accAmount: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    accAmount += token.state.data.amount;
    acc.push(token);
    if (accAmount >= amount) {
      return acc;
    }
  }

  if (accAmount < amount) {
    return [];
  }
}

export function pick3to1(
  tokens: Array<TokenContract>,
  amount: bigint,
): Array<TokenContract> {
  // reverse to get ASC order.
  tokens.reverse();

  const acc: Array<TokenContract> = [];
  let accAmount: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.state.data.amount === amount / 3n) {
      accAmount += token.state.data.amount;
      acc.push(token);
      if (accAmount >= amount) {
        return acc;
      }
    }
  }

  if (accAmount < amount) {
    return [];
  }
}

export function pickMore(
  tokens: Array<TokenContract>,
  amount: bigint,
): Array<TokenContract> {
  // reverse to get amount in ASC order.
  tokens.reverse();
  const acc: Array<TokenContract> = [];
  let accAmount: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    accAmount += token.state.data.amount;
    acc.push(token);
    if (accAmount >= amount) {
      return acc;
    }
  }

  if (accAmount < amount) {
    return [];
  }
}

export function pickLargeFeeUtxo(feeUtxos: Array<UTXO>): UTXO {
  let max = feeUtxos[0];

  for (const utxo of feeUtxos) {
    if (utxo.satoshis > max.satoshis) {
      max = utxo;
    }
  }
  return max;
}
