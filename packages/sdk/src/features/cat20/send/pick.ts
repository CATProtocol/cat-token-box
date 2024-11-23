import { UTXO } from 'scrypt-ts';
import { Cat20Utxo } from '../../../lib/provider';
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


export function pick3to1(
  tokens: Array<Cat20Utxo>,
  amount: bigint,
): Array<Cat20Utxo> {
  // reverse to get ASC order.
  tokens.reverse();

  const acc: Array<Cat20Utxo> = [];
  let accAmount: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.state.amount === amount / 3n) {
      accAmount += token.state.amount;
      acc.push(token);
      if (accAmount >= amount) {
        return acc;
      }
    }
  }

  return [];
}

export function pickMore(
  tokens: Array<Cat20Utxo>,
  amount: bigint,
): Array<Cat20Utxo> {
  // reverse to get amount in ASC order.
  tokens.reverse();
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

export function pickLargeFeeUtxo(feeUtxos: Array<UTXO>): UTXO {
  let max = feeUtxos[0];

  for (const utxo of feeUtxos) {
    if (utxo.satoshis > max.satoshis) {
      max = utxo;
    }
  }
  return max;
}


export function calcTotalAmount(tokens: Cat20Utxo[]) {
  return tokens.reduce((acc, t) => acc + t.state.amount, 0n);
}
