import { NFTContract } from "./contact";
import { UTXO } from "scrypt-ts";

export function pick(
  tokens: Array<NFTContract>,
  localId: bigint
): Array<NFTContract> {
  let t = tokens.find((token) => {
    return token.state.data.localId === localId;
  });

  // if found a token utxo contains enough token localId
  if (t) {
    return [t];
  }

  t = tokens.find((token) => {
    return token.state.data.localId > localId;
  });

  // if found a token utxo contains enough token localId
  if (t) {
    return [t];
  }

  const acc: Array<NFTContract> = [];
  let acclocalId: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    acclocalId += token.state.data.localId;
    acc.push(token);
    if (acclocalId >= localId) {
      return acc;
    }
  }

  return [];
}

export function pick3to1(
  tokens: Array<NFTContract>,
  localId: bigint
): Array<NFTContract> {
  // reverse to get ASC order.
  tokens.reverse();

  const acc: Array<NFTContract> = [];
  let acclocalId: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.state.data.localId === localId / 3n) {
      acclocalId += token.state.data.localId;
      acc.push(token);
      if (acclocalId >= localId) {
        return acc;
      }
    }
  }

  return [];
}

export function pickMore(
  tokens: Array<NFTContract>,
  localId: bigint
): Array<NFTContract> {
  // reverse to get localId in ASC order.
  tokens.reverse();
  const acc: Array<NFTContract> = [];
  let acclocalId: bigint = 0n;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    acclocalId += token.state.data.localId;
    acc.push(token);
    if (acclocalId >= localId) {
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
