import { script } from 'bitcoinjs-lib';
import { parseTokenInfo } from '../src/common/utils';

describe('parsing token info from redeem script', () => {
  const correctCbor =
    'a3646e616d656268686673796d626f6c62686868646563696d616c7300';
  const correctInfo = { name: 'hh', symbol: 'hh', decimals: 0 };
  // {"name":"hh","decimals":0}
  const incompleteCbor = 'a2646e616d6562686868646563696d616c7300';
  const invalidCbor = incompleteCbor.substring(2);

  it('should throw when parsing invalid script', () => {
    expect(() => parseTokenInfo(Buffer.from('0201', 'hex'))).toThrow(
      'parse token info error',
    );
  });

  it('should return null when script is empty', () => {
    expect(parseTokenInfo(null)).toBeNull();
    expect(parseTokenInfo(Buffer.alloc(0))).toBeNull();
  });

  it('should return null when script missing the envelope', () => {
    const scriptHex = script.fromASM(`${incompleteCbor}`).toString('hex');
    expect(parseTokenInfo(Buffer.from(scriptHex, 'hex'))).toBeNull();
  });

  it('should return null when token info missing fields', () => {
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_1 ${incompleteCbor} OP_ENDIF`)
      .toString('hex');
    expect(parseTokenInfo(Buffer.from(scriptHex, 'hex'))).toBeNull();
  });

  it('should throw when parsing incorrect cbor encoding', () => {
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_1 ${invalidCbor} OP_ENDIF`)
      .toString('hex');
    expect(() => parseTokenInfo(Buffer.from(scriptHex, 'hex'))).toThrow(
      'parse token info error',
    );
  });

  it('should pass when token info consists of a single pushdata', () => {
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_1 ${correctCbor} OP_ENDIF`)
      .toString('hex');
    expect(parseTokenInfo(Buffer.from(scriptHex, 'hex'))).toEqual(correctInfo);
  });

  it('should pass when token info consists of multiple pushdata', () => {
    const index = 10;
    const pushdata1 = correctCbor.substring(0, index);
    const pushdaat2 = correctCbor.substring(index);
    const scriptHex = script
      .fromASM(`OP_0 OP_IF 636174 OP_1 ${pushdata1} ${pushdaat2} OP_ENDIF`)
      .toString('hex');
    expect(parseTokenInfo(Buffer.from(scriptHex, 'hex'))).toEqual(correctInfo);
  });
});
