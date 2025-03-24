import {
    ByteString,
    hash160,
    Outpoint,
    OWNER_ADDR_P2WPKH_BYTE_LEN,
    TAPROOT_ONLY_SCRIPT_SPENT_KEY,
    toByteString,
    TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN,
    UTXO,
} from '@scrypt-inc/scrypt-ts-btc';
import { Tap } from '@cmdcode/tapscript';
import { SupportedNetwork } from './constants';
import {
    Network,
    networks,
    payments,
    Psbt,
    TxInput,
    address,
    LEAF_VERSION_TAPSCRIPT,
    script,
} from '@scrypt-inc/bitcoinjs-lib';
import { randomBytes } from 'crypto';
import { encodingLength, encode } from 'varuint-bitcoin';

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

export function addressToLocking(_address: string): string {
    return uint8ArrayToHex(address.toOutputScript(_address));
}

export function scriptToP2tr(script: Uint8Array): {
    p2trLockingScript: string;
    tapScript: string;
    cblock: string;
} {
    const tapScript = Tap.encodeScript(script);
    const [tpubkey, cblock] = Tap.getPubKey(TAPROOT_ONLY_SCRIPT_SPENT_KEY, {
        target: tapScript,
        version: LEAF_VERSION_TAPSCRIPT,
    });
    return {
        p2trLockingScript: xPubkeyToP2trLockingScript(tpubkey),
        tapScript,
        cblock,
    };
}

export function toTxOutpoint(txid: string, outputIndex: number): Outpoint {
    const outputBuf = Buffer.alloc(4, 0);
    outputBuf.writeUInt32LE(outputIndex);
    return {
        txHash: Buffer.from(txid, 'hex').reverse().toString('hex'),
        outputIndex: outputBuf.toString('hex'),
    };
}

export function outpoint2TxOutpoint(outpoint: string): Outpoint {
    const [txid, vout] = outpoint.split('_');
    return toTxOutpoint(txid, parseInt(vout));
}

export const outpoint2ByteString = function (outpoint: string) {
    const txOutpoint = outpoint2TxOutpoint(outpoint);
    return txOutpoint.txHash + txOutpoint.outputIndex;
};

export function toBitcoinNetwork(network: SupportedNetwork): Network {
    if (network === 'btc-signet') {
        return networks.testnet;
    } else if (network === 'fractal-mainnet' || network === 'fractal-testnet') {
        return networks.bitcoin;
    } else {
        throw new Error(`invalid network ${network}`);
    }
}

export function p2trLockingScriptToAddr(p2tr: string, network: SupportedNetwork = 'fractal-mainnet') {
    return payments.p2tr({
        output: hexToUint8Array(p2tr),
        network: toBitcoinNetwork(network),
    }).address;
}

export function addrToP2trLockingScript(_address: string): string {
    const lockingScript = uint8ArrayToHex(address.toOutputScript(_address));
    if (lockingScript.length !== Number(TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN * 2n)) {
        throw new Error(`invalid p2tr locking script ${lockingScript}`);
    }
    return lockingScript;
}

export function xPubkeyToP2trLockingScript(xPubkey: string): string {
    return uint8ArrayToHex(script.fromASM(`OP_1 0x${xPubkey}`));
}

// export function xPubkeyToAddr(xPubkey: string, network: SupportedNetwork = 'fractal-mainnet') {
//     return p2trLockingScriptToAddr(xPubkeyToP2trLockingScript(xPubkey).toHex(), network);
// }

// export function toPsbt(tx: btc.Transaction): bitcoinjs.Psbt {
//     const psbt = btcSigner.Transaction.fromRaw(tx.toBuffer(), {
//         allowUnknownOutputs: true,
//     });
//     // TODO: fillup utxo info
//     return bitcoinjs.Psbt.fromBuffer(psbt.toPSBT());
// }

// export function toPsbtHex(tx: btc.Transaction): string {
//     return toPsbt(tx).toHex();
// }

export function toXOnly(pubKeyHex: string, isP2TR: boolean): string {
    const pubKey = Buffer.from(pubKeyHex, 'hex');
    if (pubKey.length !== 33) {
        throw new Error('invalid pubkey');
    }
    if (isP2TR) {
        const payment = payments.p2tr({
            internalPubkey: Uint8Array.from(pubKey.subarray(1, 33)),
        });

        return Buffer.from(payment.pubkey).toString('hex');
    } else {
        const xOnlyPubKey = pubKey.subarray(1, 33);
        return xOnlyPubKey.toString('hex');
    }
}

export function pubKeyPrefix(pubKeyHex: string): string {
    const pubKey = Buffer.from(pubKeyHex, 'hex');
    if (pubKey.length !== 33) {
        throw new Error('invalid pubkey');
    }
    return pubKey.subarray(0, 1).toString('hex');
}

// export function getUnfinalizedTxId(psbt: Psbt): string {
//     return (psbt as any).__CACHE.__TX.getId();
// }

// export function getDummyAddress(): btc.Address {
//     const privateKey = btc.PrivateKey.fromRandom();
//     return btc.Address.fromPublicKey(privateKey.toPublicKey());
// }

export function getDummyUtxo(_address?: string, satoshis?: number): UTXO {
    return {
        address: _address,
        txId: randomBytes(32).toString('hex'),
        outputIndex: 0,
        script: uint8ArrayToHex(address.toOutputScript(_address)),
        satoshis: satoshis || 9007199254740991,
    };
}

export function getDummyUtxos(address: string, count: number, satoshis?: number): UTXO[] {
    return Array.from({ length: count }, () => getDummyUtxo(address, satoshis));
}

export function catToXOnly(pubKeyHex: string, isP2TR: boolean): string {
    const pubKey = hexToUint8Array(pubKeyHex);
    if (pubKey.length !== 33) {
        throw new Error('invalid pubkey');
    }
    if (isP2TR) {
        const payment = payments.p2tr({
            internalPubkey: pubKey.subarray(1, 33),
        });

        return Buffer.from(payment.pubkey).toString('hex');
    } else {
        const xOnlyPubKey = pubKey.subarray(1, 33);
        return uint8ArrayToHex(xOnlyPubKey);
    }
}

// export function validteSupportedAddress(address: string): btc.Address {
//     try {
//         const addr = btc.Address.fromString(address);
//         if (
//             addr.type === btc.Address.PayToTaproot ||
//             addr.type === btc.Address.PayToWitnessPublicKeyHash ||
//             addr.type === btc.Address.PayToWitnessScriptHash
//         ) {
//             return addr;
//         }
//         throw new Error(`Unsupported address type ${addr.type}, only support p2tr and p2wpkh`);
//     } catch (e) {
//         throw new Error(`Invalid address ${address}`);
//     }
// }

export function toTokenAddress(_address: string): ByteString {
    const lockingScript = uint8ArrayToHex(address.toOutputScript(_address));
    if (lockingScript.length == Number(TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN * 2n)) {
        if (lockingScript.startsWith('5120')) {
            // p2tr
            return toByteString(lockingScript);
        } else if (lockingScript.startsWith('0020')) {
            // p2wsh
            return toByteString(hash160(lockingScript));
        } else {
            throw new Error(`Unsupported address type: ${address}`);
        }
    } else if (lockingScript.length == Number(OWNER_ADDR_P2WPKH_BYTE_LEN * 2n)) {
        if (lockingScript.startsWith('0014')) {
            // p2wpkh
            return toByteString(lockingScript);
        } else {
            throw new Error(`Unsupported address type: ${address}`);
        }
    } else {
        throw new Error(`Unsupported address type: ${address}`);
    }
}

export function getTxId(input: TxInput): string {
    const hash = input.hash.slice();
    return Buffer.from(hash.reverse()).toString('hex');
}

export function sleep(seconds: number) {
    return new Promise(function (resolve) {
        setTimeout(resolve, seconds * 1000);
    });
}

export function dummySig(psbt: Psbt, _address: string) {
    const scriptHex = uint8ArrayToHex(address.toOutputScript(_address));

    psbt.data.inputs.forEach((input, index) => {
        if (isTaprootInput(input)) {
            if (!input.witnessUtxo) {
                throw new Error(`taproot input without witnessUtxo!`);
            }

            const witnessUtxoScript = Buffer.from(input.witnessUtxo?.script).toString('hex');
            if (witnessUtxoScript === scriptHex) {
                // dummy signature
                const schnorrSig = new Uint8Array(Buffer.alloc(65));
                psbt.updateInput(index, {
                    finalScriptWitness: witnessStackToScriptWitness([schnorrSig]),
                });
            }
        } else {
            // dummy pubkey and dummy signature
            const pubkey = new Uint8Array(Buffer.alloc(33));
            const signature = new Uint8Array(Buffer.alloc(72));
            psbt.updateInput(index, {
                finalScriptWitness: witnessStackToScriptWitness([signature, pubkey]),
            });
        }
    });
}

export function uint8ArrayToHex(uint8Array: Uint8Array): ByteString {
    return Array.from(uint8Array)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export function hexToUint8Array(hexString: string): Uint8Array {
    // Remove any leading 0x or spaces
    hexString = hexString.replace(/^0x/, '').replace(/\s+/g, '');
    if (hexString.length % 2 !== 0) {
        throw new Error('Invalid hex string');
    }
    // Convert to Uint8Array
    const uint8Array = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < hexString.length / 2; i += 1) {
        // console.log('i', hexString.slice(i))
        uint8Array[i] = parseInt(hexString.slice(i * 2, i * 2 + 2), 16);
    }
    return uint8Array;
}
export function witnessStackToScriptWitness(witness: Uint8Array[]) {
    let buffer = new Uint8Array(0);
    function writeSlice(slice: Uint8Array) {
        buffer = Uint8Array.from(Buffer.concat([buffer, slice]));
    }
    function writeVarInt(i: number) {
        const currentLen = buffer.length;
        const varintLen = encodingLength(i);
        buffer = Uint8Array.from(Buffer.concat([buffer, new Uint8Array(varintLen)]));
        encode(i, buffer, currentLen);
    }
    function writeVarSlice(slice: Uint8Array) {
        writeVarInt(slice.length);
        writeSlice(slice);
    }
    function writeVector(vector: Uint8Array[]) {
        writeVarInt(vector.length);
        vector.forEach(writeVarSlice);
    }
    writeVector(witness);
    return buffer;
}

export function isTaprootInput(input) {
    return (
        input &&
        !!(
            input.tapInternalKey ||
            input.tapMerkleRoot ||
            (input.tapLeafScript && input.tapLeafScript.length) ||
            (input.tapBip32Derivation && input.tapBip32Derivation.length) ||
            (input.witnessUtxo && isP2TR(input.witnessUtxo.script))
        )
    );
}

// export function isFinalized(input: any) {
//     return !!input.finalScriptSig || !!input.finalScriptWitness;
// }
/**
 * Checks if a given payment factory can generate a payment script from a given script.
 * @param payment The payment factory to check.
 * @returns A function that takes a script and returns a boolean indicating whether the payment factory can generate a payment script from the script.
 */
function isPaymentFactory(payment) {
    return (scriptOrAddr) => {
        if (typeof scriptOrAddr === 'string') {
            try {
                payment({ address: scriptOrAddr });
                return true;
            } catch (err) {
                return false;
            }
        } else {
            try {
                payment({ output: scriptOrAddr });
                return true;
            } catch (err) {
                return false;
            }
        }
    };
}

export function isP2TR(scriptOrAddr: Buffer | string) {
    return isPaymentFactory(payments.p2tr)(scriptOrAddr);
}

export function isP2WPKH(scriptOrAddr: Buffer | string) {
    return isPaymentFactory(payments.p2wpkh)(scriptOrAddr);
}

export function script2Addr(script: Buffer) {
    if (isP2TR(script)) {
        return payments.p2tr({ output: script }).address;
    } else if (isP2WPKH(script)) {
        return payments.p2wpkh({ output: script }).address;
    } else {
        throw new Error('invalid script type: ' + script.toString('hex'));
    }
}

export function filterFeeUtxos(utxos: UTXO[]): UTXO[] {
    return utxos.sort((a, b) => b.satoshis - a.satoshis).filter((utxo) => utxo.satoshis >= 10000);
}

export function sumUtxosSatoshi(utxos: UTXO[]): number {
    return utxos.reduce((acc, utxo) => acc + utxo.satoshis, 0);
}
