import { ByteString, ExtPsbt, FixedArray, satoshiToHex } from '@scrypt-inc/scrypt-ts-btc';

export function applyArray<T, COUNT extends number>(
    changesArray: T[],
    toFixedArray: FixedArray<T, COUNT>,
    toStartIndex = 0,
) {
    for (let i = 0; i < changesArray.length; i++) {
        toFixedArray[toStartIndex + i] = changesArray[i];
    }
}

export function getOutputSatoshisList(psbt: ExtPsbt): ByteString[] {
    return psbt.txOutputs.map((output) => satoshiToHex(output.value));
}
