import { payments, script } from 'bitcoinjs-lib';
import { Constants, network } from './constants';
import { hash160 } from 'bitcoinjs-lib/src/crypto';
import { decode as cborDecode } from 'cbor';
import { TokenInfo } from './types';

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function okResponse(data: any) {
  return {
    code: 0,
    msg: 'OK',
    data: data,
  };
}

export function errorResponse(e: Error) {
  return {
    code: 100,
    msg: e.message,
    data: null,
  };
}

export function xOnlyPubKeyToAddress(xOnlyPubKey: string) {
  try {
    const pubkey = Buffer.from(xOnlyPubKey, 'hex');
    return payments.p2tr({ pubkey, network }).address;
  } catch {
    return null;
  }
}

export function addressToXOnlyPubKey(addr: string) {
  try {
    return payments.p2tr({ address: addr, network }).pubkey.toString('hex');
  } catch {
    return null;
  }
}

export function ownerAddressToPubKeyHash(ownerAddr: string) {
  try {
    const pubKey = addressToXOnlyPubKey(ownerAddr);
    if (pubKey) {
      return hash160(Buffer.from(pubKey, 'hex')).toString('hex');
    }
    return (
      payments
        .p2wpkh({
          address: ownerAddr,
          network,
        })
        ?.hash?.toString('hex') || null
    );
  } catch {
    return null;
  }
}

export function parseTokenInfo(redeemScript: Buffer): TokenInfo | null {
  try {
    const asm = script.toASM(redeemScript || Buffer.alloc(0));
    const match = asm.match(Constants.TOKEN_INFO_ENVELOPE);
    if (match && match[1]) {
      const cborBuffer = Buffer.from(match[1].replaceAll(' ', ''), 'hex');
      const tokenInfo = cborDecode(cborBuffer);
      if (
        tokenInfo['name'] !== undefined &&
        tokenInfo['symbol'] !== undefined &&
        tokenInfo['decimals'] !== undefined
      ) {
        return tokenInfo as TokenInfo;
      }
    }
  } catch (e) {
    throw new Error(`parse token info error, ${e.message}`);
  }
  return null;
}

export interface TaprootPayment {
  pubkey?: Buffer;
  redeemScript?: Buffer;
  witness?: Buffer[];
}
