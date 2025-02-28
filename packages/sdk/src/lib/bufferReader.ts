import * as varuint from 'varuint-bitcoin';
import * as v from 'valibot';
import * as tools from 'uint8array-tools';

export const BufferSchema = v.instance(Uint8Array);
export const UInt32Schema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(0xffffffff));
const MAX_JS_NUMBER = 0x001fffffffffffff;

// https://github.com/feross/buffer/blob/master/index.js#L1127
function verifuint(value: number | bigint, max: number): void {
    if (typeof value !== 'number' && typeof value !== 'bigint')
        throw new Error('cannot write a non-number as a number');
    if (value < 0 && value < BigInt(0)) throw new Error('specified a negative value for writing an unsigned value');
    if (value > max && value > BigInt(max)) throw new Error('RangeError: value out of range');
    if (Math.floor(Number(value)) !== Number(value)) throw new Error('value has a fractional component');
}

export class BufferReader {
    constructor(public buffer: Uint8Array, public offset: number = 0) {
        v.parse(v.tuple([BufferSchema, UInt32Schema]), [buffer, offset]);
    }

    readUInt8(): number {
        const result = tools.readUInt8(this.buffer, this.offset);
        this.offset++;
        return result;
    }

    readInt32(): number {
        const result = tools.readInt32(this.buffer, this.offset, 'LE');
        this.offset += 4;
        return result;
    }

    readUInt32(): number {
        const result = tools.readUInt32(this.buffer, this.offset, 'LE');
        this.offset += 4;
        return result;
    }

    readInt64(): bigint {
        const result = tools.readInt64(this.buffer, this.offset, 'LE');
        this.offset += 8;
        return result;
    }

    readVarInt(): bigint {
        const { bigintValue, bytes } = varuint.decode(this.buffer, this.offset);
        this.offset += bytes;
        return bigintValue;
    }

    readSlice(n: number | bigint): Uint8Array {
        verifuint(n, MAX_JS_NUMBER);
        const num = Number(n);
        if (this.buffer.length < this.offset + num) {
            throw new Error('Cannot read slice out of bounds');
        }
        const result = this.buffer.slice(this.offset, this.offset + num);
        this.offset += num;
        return result;
    }

    readVarSlice(): Uint8Array {
        return this.readSlice(this.readVarInt());
    }

    readVector(): Uint8Array[] {
        const count = this.readVarInt();
        const vector: Uint8Array[] = [];
        for (let i = 0; i < count; i++) vector.push(this.readVarSlice());
        return vector;
    }
}
