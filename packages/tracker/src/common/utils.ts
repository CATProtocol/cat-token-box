import { address, payments, script } from 'bitcoinjs-lib';
import { Constants, network } from './constants';
import { decode as cborDecode } from 'cbor';
import { EnvelopeMarker, EnvelopeData, TokenInfoEnvelope } from './types';

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function okResponse(data: any) {
  return {
    code: 0,
    msg: 'OK',
    data,
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
    return Buffer.from(
      payments.p2tr({ address: addr, network }).pubkey,
    ).toString('hex');
  } catch {
    return null;
  }
}

export function ownerAddressToPubKeyHash(ownerAddr: string) {
  try {
    return ownerAddr?.length === Constants.CONTRACT_OWNER_ADDR_BYTES * 2
      ? ownerAddr
      : Buffer.from(address.toOutputScript(ownerAddr, network)).toString('hex');
  } catch {
    return null;
  }
}

export function parseTokenInfoEnvelope(
  redeemScript: Buffer,
): TokenInfoEnvelope | null {
  try {
    const asm = script.toASM(redeemScript || Buffer.alloc(0));
    const match = asm.match(Constants.TOKEN_INFO_ENVELOPE);
    if (match && match[1] && match[2]) {
      switch (match[1]) {
        case EnvelopeMarker.Token:
          const cborBuffer = Buffer.from(match[2].replaceAll(' ', ''), 'hex');
          const metadata = cborDecode(cborBuffer);
          if (
            metadata &&
            metadata['name'] !== undefined &&
            metadata['symbol'] !== undefined &&
            metadata['decimals'] !== undefined
          ) {
            return {
              marker: EnvelopeMarker.Token,
              data: { metadata },
            };
          }
          break;
        case EnvelopeMarker.Collection:
          const info = parseEnvelope(match[2]);
          if (
            info &&
            info.metadata &&
            info.metadata['name'] !== undefined &&
            info.metadata['symbol'] !== undefined
          ) {
            return {
              marker: EnvelopeMarker.Collection,
              data: info,
            };
          }
          break;
        case EnvelopeMarker.NFT:
          return {
            marker: EnvelopeMarker.NFT,
            data: parseEnvelope(match[2]),
          };
      }
    }
  } catch (e) {
    throw new Error(`parse token info envelope error, ${e.message}`);
  }
  return null;
}

export function parseEnvelope(envelope: string): EnvelopeData | null {
  const items = envelope.split(' ');
  let i = 0;
  let contentRaw: Buffer | undefined = undefined;
  let contentType: string | undefined = undefined;
  let contentEncoding: string | undefined = undefined;
  let metadataHex: string = '';
  let delegate: Buffer | undefined = undefined;
  while (i < items.length - 1) {
    if (items[i] === '00' || items[i] === 'OP_0') {
      // content raw
      contentRaw = Buffer.from(items.slice(i + 1).join(''), 'hex');
      break;
    } else if (items[i] === '01' || items[i] === 'OP_1') {
      // content type
      contentType = Buffer.from(items[i + 1], 'hex').toString('utf8');
      i += 2;
    } else if (items[i] === '05' || items[i] === 'OP_5') {
      // metadata
      metadataHex += items[i + 1];
      i += 2;
    } else if (items[i] === '09' || items[i] === 'OP_9') {
      // content encoding
      contentEncoding = Buffer.from(items[i + 1], 'hex').toString('utf8');
      i += 2;
    } else if (items[i] === '0b' || items[i] === '0B' || items[i] === 'OP_11') {
      // delegate
      delegate = Buffer.from(items[i + 1], 'hex');
      i += 2;
    } else {
      i++;
    }
  }
  const metadata =
    metadataHex === ''
      ? undefined
      : cborDecode(Buffer.from(metadataHex, 'hex'));
  let content = undefined;
  if (delegate && delegate.length >= 32 && delegate.length <= 36) {
    content = {
      raw: delegate,
      type: Constants.CONTENT_TYPE_CAT721_DELEGATE_V1,
    };
  } else if (contentRaw || contentType || contentEncoding) {
    content = {
      raw: contentRaw,
      type: contentType,
      encoding: contentEncoding,
    };
  }
  return metadata || content ? { metadata, content } : null;
}
