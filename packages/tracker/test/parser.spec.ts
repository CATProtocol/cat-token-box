import { script } from 'bitcoinjs-lib';
import { parseTokenInfoEnvelope } from '../src/common/utils';
import { EnvelopeMarker } from '../src//common/types';

describe('parsing token info from redeem script', () => {
  const correctCbor =
    'a3646e616d656268686673796d626f6c62686868646563696d616c7300';
  const correctInfo = { name: 'hh', symbol: 'hh', decimals: 0 };
  // {"name":"hh","decimals":0}
  const incompleteCbor = 'a2646e616d6562686868646563696d616c7300';
  const invalidCbor = incompleteCbor.substring(2);

  it('should throw when parsing invalid script', () => {
    expect(() => parseTokenInfoEnvelope(Buffer.from('0201', 'hex'))).toThrow(
      'parse token info envelope error',
    );
  });

  it('should return null when script is empty', () => {
    expect(parseTokenInfoEnvelope(null)).toBeNull();
    expect(parseTokenInfoEnvelope(Buffer.alloc(0))).toBeNull();
  });

  it('should return null when script missing the envelope', () => {
    const scriptHex = script.fromASM(`${incompleteCbor}`).toString('hex');
    expect(parseTokenInfoEnvelope(Buffer.from(scriptHex, 'hex'))).toBeNull();
  });

  it('should return null when token info missing fields', () => {
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_1 ${incompleteCbor} OP_ENDIF`)
      .toString('hex');
    expect(parseTokenInfoEnvelope(Buffer.from(scriptHex, 'hex'))).toBeNull();
  });

  it('should throw when parsing incorrect cbor encoding', () => {
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_1 ${invalidCbor} OP_ENDIF`)
      .toString('hex');
    expect(() => parseTokenInfoEnvelope(Buffer.from(scriptHex, 'hex'))).toThrow(
      'parse token info envelope error',
    );
  });

  it('should pass when token info consists of a single pushdata', () => {
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_1 ${correctCbor} OP_ENDIF`)
      .toString('hex');
    expect(parseTokenInfoEnvelope(Buffer.from(scriptHex, 'hex'))).toEqual({
      marker: EnvelopeMarker.Token,
      data: { metadata: correctInfo },
    });
  });

  it('should pass when token info consists of multiple pushdata', () => {
    const index = 10;
    const pushdata1 = correctCbor.substring(0, index);
    const pushdaat2 = correctCbor.substring(index);
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_1 ${pushdata1} ${pushdaat2} OP_ENDIF`)
      .toString('hex');
    expect(parseTokenInfoEnvelope(Buffer.from(scriptHex, 'hex'))).toEqual({
      marker: EnvelopeMarker.Token,
      data: { metadata: correctInfo },
    });
  });

  it('should pass when parsing correct collection info', () => {
    const metadata = { name: 'hh', symbol: 'hh' };
    const cbor = 'a2646e616d656268686673796d626f6c626868';
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_2 OP_5 ${cbor} OP_ENDIF`)
      .toString('hex');
    expect(parseTokenInfoEnvelope(Buffer.from(scriptHex, 'hex'))).toEqual({
      marker: EnvelopeMarker.Collection,
      data: { metadata },
    });
  });
});
