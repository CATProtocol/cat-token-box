import { default as cbor } from 'cbor';
import { script } from '@scrypt-inc/bitcoinjs-lib';

const limit = 520;

export function toPushData(data: Buffer): Buffer {
    const res: Array<Buffer> = [];

    const dLen = data.length;
    if (dLen < 0x4c) {
        const dLenBuff = Buffer.alloc(1);
        dLenBuff.writeUInt8(dLen);
        res.push(dLenBuff);
    } else if (dLen <= 0xff) {
        // OP_PUSHDATA1
        res.push(Buffer.from('4c', 'hex'));

        const dLenBuff = Buffer.alloc(1);
        dLenBuff.writeUInt8(dLen);
        res.push(dLenBuff);
    } else if (dLen <= 0xffff) {
        // OP_PUSHDATA2
        res.push(Buffer.from('4d', 'hex'));

        const dLenBuff = Buffer.alloc(2);
        dLenBuff.writeUint16LE(dLen);
        res.push(dLenBuff);
    } else {
        // OP_PUSHDATA4
        res.push(Buffer.from('4e', 'hex'));

        const dLenBuff = Buffer.alloc(4);
        dLenBuff.writeUint32LE(dLen);
        res.push(dLenBuff);
    }

    res.push(data);

    return Buffer.concat(res);
}

export function chunks<T>(bin: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    let offset = 0;

    while (offset < bin.length) {
        // Use Buffer.slice to create a chunk. This method does not copy the memory;
        // it creates a new Buffer that references the original memory.
        const chunk = bin.slice(offset, offset + chunkSize);
        chunks.push(chunk);
        offset += chunkSize;
    }

    return chunks;
}

export const getCatCommitScript = (
    leafKeyXPub: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any>,
) => {
    const m = new Map();
    for (const key in metadata) {
        m.set(key, metadata[key]);
    }
    const data = Buffer.from(cbor.encode(m));

    const res = [];

    res.push(
        toPushData(Buffer.from(leafKeyXPub, 'hex')), // 0 OP_IF "cat"
    );
    res.push(Buffer.from(script.fromASM('OP_CHECKSIGVERIFY'))); // checkSig
    res.push(Buffer.from(script.fromASM('OP_2DROP OP_2DROP OP_DROP'))); // drop all stateHashes in the witness
    res.push(Buffer.from(script.fromASM('OP_0 OP_IF 636174'))); //  cat protocal envelope start
    res.push(Buffer.from(script.fromASM('OP_1'))); // cat FT

    const dataChunks = chunks(Array.from(data), limit);

    // if the metadata exceeds the limit of 520, it is split into multiple chunks.
    for (const chunk of dataChunks) {
        res.push(toPushData(Buffer.from(chunk)));
    }

    res.push(Buffer.from(script.fromASM('OP_ENDIF'))); // cat protocal envelope end

    res.push(Buffer.from(script.fromASM('OP_1'))); // put true on top stack

    return Buffer.concat(res).toString('hex');
};

export const getCatCollectionCommitScript = (
    leafKeyXPub: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any>,
    content?: {
        type: string;
        body: string;
    },
) => {
    const res = [];

    res.push(
        toPushData(Buffer.from(leafKeyXPub, 'hex')), // 0 OP_IF "cat"
    );

    res.push(Buffer.from(script.fromASM('OP_CHECKSIGVERIFY'))); // checkSig
    res.push(Buffer.from(script.fromASM('OP_2DROP OP_2DROP OP_DROP'))); // drop all stateHashes in the witness
    res.push(Buffer.from(script.fromASM('OP_0 OP_IF 636174'))); //  cat protocal envelope start
    res.push(Buffer.from(script.fromASM('OP_2'))); // cat NFT collection

    if (Object.keys(metadata).length > 0) {
        const m = new Map();
        for (const key in metadata) {
            m.set(key, metadata[key]);
        }

        const metadataChunks = chunks(Array.from(Buffer.from(cbor.encode(m))), limit);

        // if the metadata exceeds the limit of 520, it is split into multiple chunks.
        for (const chunk of metadataChunks) {
            res.push(toPushData(Buffer.from([5])));
            res.push(toPushData(Buffer.from(chunk)));
        }
    }

    if (content) {
        res.push(toPushData(Buffer.from([1])));

        res.push(toPushData(Buffer.from(content.type, 'utf-8')));

        res.push(Buffer.from([0]));

        const dataChunks = chunks(Array.from(Buffer.from(content.body, 'hex')), limit);

        // if the contentBody exceeds the limit of 520, it is split into multiple chunks.
        for (const chunk of dataChunks) {
            res.push(toPushData(Buffer.from(chunk)));
        }
    }

    res.push(Buffer.from(script.fromASM('OP_ENDIF'))); // cat protocal envelope end

    res.push(Buffer.from(script.fromASM('OP_1'))); // put true on top stack

    return Buffer.concat(res).toString('hex');
};

export const getCatNFTCommitScript = (
    leafKeyXPub: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any>,
    content?: {
        type: string;
        body: string;
    },
) => {
    const res = [];
    res.push(
        toPushData(Buffer.from(leafKeyXPub, 'hex')), // 0 OP_IF "cat"
    );

    res.push(Buffer.from(script.fromASM('OP_CHECKSIGVERIFY'))); // checkSig
    res.push(Buffer.from(script.fromASM('OP_0 OP_IF 636174'))); //  cat protocal envelope start
    res.push(Buffer.from(script.fromASM('OP_3'))); // cat NFT

    if (Object.keys(metadata).length > 0) {
        const m = new Map();
        for (const key in metadata) {
            m.set(key, metadata[key]);
        }

        const metadataChunks = chunks(Array.from(Buffer.from(cbor.encode(m))), limit);

        // if the metadata exceeds the limit of 520, it is split into multiple chunks.
        for (const chunk of metadataChunks) {
            res.push(toPushData(Buffer.from([5])));
            res.push(toPushData(Buffer.from(chunk)));
        }
    }

    if (content) {
        res.push(toPushData(Buffer.from([1])));

        res.push(toPushData(Buffer.from(content.type, 'utf-8')));

        res.push(Buffer.from([0]));

        const dataChunks = chunks(Array.from(Buffer.from(content.body, 'hex')), limit);

        // if the contentBody exceeds the limit of 520, it is split into multiple chunks.
        for (const chunk of dataChunks) {
            res.push(toPushData(Buffer.from(chunk)));
        }
    }

    res.push(Buffer.from(script.fromASM('OP_ENDIF'))); // cat protocal envelope end

    res.push(Buffer.from(script.fromASM('OP_1'))); // put true on top stack

    return Buffer.concat(res).toString('hex');
};
