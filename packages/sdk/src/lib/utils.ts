import { Tap } from '@cmdcode/tapscript';
import { LEAF_VERSION_TAPSCRIPT, bitcoinjs, btc } from './btc';
import { SupportedNetwork, TAPROOT_ONLY_SCRIPT_SPENT_KEY } from './constants';
import * as btcSigner from '@scure/btc-signer';
import { Network, networks, payments, Psbt, TxInput } from 'bitcoinjs-lib';
import { randomBytes } from 'crypto';
import { ByteString, hash160, Ripemd160, UTXO } from 'scrypt-ts';
import { encodingLength, encode } from 'varuint-bitcoin';
import { TxOutpoint } from '../contracts/types';

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

export function toTxOutpoint(txid: string, outputIndex: number): TxOutpoint {
    const outputBuf = Buffer.alloc(4, 0);
    outputBuf.writeUInt32LE(outputIndex);
    return {
        txHash: Buffer.from(txid, 'hex').reverse().toString('hex'),
        outputIndex: outputBuf.toString('hex'),
    };
}

export function outpoint2TxOutpoint(outpoint: string): TxOutpoint {
    const [txid, vout] = outpoint.split('_');
    return toTxOutpoint(txid, parseInt(vout));
}

export const outpoint2ByteString = function (outpoint: string) {
    const txOutpoint = outpoint2TxOutpoint(outpoint);
    return txOutpoint.txHash + txOutpoint.outputIndex;
};

export function scriptToP2tr(script: Buffer): {
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
        p2trLockingScript: xPubkeyToP2trLockingScript(tpubkey).toHex(),
        tapScript,
        cblock,
    };
}

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

export function addrToP2trLockingScript(address: string | btc.Address): string {
    const p2trAddress = typeof address === 'string' ? btc.Address.fromString(address) : address;

    if (p2trAddress.type !== 'taproot') {
        throw new Error(`address ${address} is not taproot`);
    }

    return uint8ArrayToHex(payments.p2tr({ address: address.toString() }).output);
}

export function xPubkeyToP2trLockingScript(xPubkey: string): btc.Script {
    return new btc.Script(`OP_1 32 0x${xPubkey}`);
}

export function xPubkeyToAddr(xPubkey: string, network: SupportedNetwork = 'fractal-mainnet') {
    return p2trLockingScriptToAddr(xPubkeyToP2trLockingScript(xPubkey).toHex(), network);
}

export function toPsbt(tx: btc.Transaction): bitcoinjs.Psbt {
    const psbt = btcSigner.Transaction.fromRaw(tx.toBuffer(), {
        allowUnknownOutputs: true,
    });
    // TODO: fillup utxo info
    return bitcoinjs.Psbt.fromBuffer(psbt.toPSBT());
}

export function toPsbtHex(tx: btc.Transaction): string {
    return toPsbt(tx).toHex();
}

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

export function getUnfinalizedTxId(psbt: Psbt): string {
    return (psbt as any).__CACHE.__TX.getId();
}

export function getDummyAddress(): btc.Address {
    const privateKey = btc.PrivateKey.fromRandom();
    return btc.Address.fromPublicKey(privateKey.toPublicKey());
}

export function getDummyUtxo(address?: string, satoshis?: number): UTXO {
    const addr = address === undefined ? getDummyAddress() : btc.Address.fromString(address);
    return {
        // address: addr.toString(),
        txId: randomBytes(32).toString('hex'),
        outputIndex: 0,
        script: btc.Script.fromAddress(addr).toHex(),
        satoshis: satoshis || 9007199254740991,
    };
}

export function getDummyUtxos(address: string, count: number, satoshis?: number): UTXO[] {
    return Array.from({ length: count }, () => getDummyUtxo(address, satoshis));
}

export function toBtcTransaction(psbt: bitcoinjs.Psbt, isFinalized = true): btc.Transaction {
    const tx = new btc.Transaction(
        isFinalized ? psbt.extractTransaction().toHex() : (psbt as any).__CACHE.__TX.toHex(),
    );
    psbt.data.inputs.forEach((input, index) => {
        tx.inputs[index].output = new btc.Transaction.Output({
            satoshis: Number(input.witnessUtxo?.value || 0),
            script: new btc.Script(Buffer.from(input.witnessUtxo?.script || '')),
        });
    });
    return tx;
}

export function validteSupportedAddress(address: string): btc.Address {
    try {
        const addr = btc.Address.fromString(address);
        if (
            addr.type === btc.Address.PayToTaproot ||
            addr.type === btc.Address.PayToWitnessPublicKeyHash ||
            addr.type === btc.Address.PayToWitnessScriptHash
        ) {
            return addr;
        }
        throw new Error(`Unsupported address type ${addr.type}, only support p2tr and p2wpkh`);
    } catch (e) {
        throw new Error(`Invalid address ${address}`);
    }
}

export function toTokenAddress(address: btc.Address | string): Ripemd160 {
    if (typeof address === 'string') {
        address = btc.Address.fromString(address);
    }
    if (address.type === btc.Address.PayToTaproot) {
        return Ripemd160('5120' + address.hashBuffer.toString('hex'));
    } else if (address.type === btc.Address.PayToWitnessPublicKeyHash) {
        return Ripemd160('0014' + address.hashBuffer.toString('hex'));
    } else if (address.type === btc.Address.PayToWitnessScriptHash) {
        return Ripemd160(hash160(btc.Script.fromAddress(address).toHex()));
    } else {
        throw new Error(`Unsupported address type: ${address.type}`);
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

export function dummySig(psbt: Psbt, address: string) {
    const scriptHex = btc.Script.fromAddress(btc.Address.fromString(address)).toHex();

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

export function isTaprootInput(input: any) {
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

export function isFinalized(input: any) {
    return !!input.finalScriptSig || !!input.finalScriptWitness;
}
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
