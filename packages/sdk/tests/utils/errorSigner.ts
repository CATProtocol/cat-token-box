import { hash256, hexToUint8Array, SignOptions, Signer, toXOnly, uint8ArrayToHex } from '@scrypt-inc/scrypt-ts-btc';
import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory, { ECPairInterface } from 'ecpair';
import * as bitcoinjs from '@scrypt-inc/bitcoinjs-lib';
import { Network } from '@scrypt-inc/bitcoinjs-lib';
const ECPair = ECPairFactory(ecc);

export class ErrorPair implements ECPairInterface {
    pair: ECPairInterface;
    constructor(privateKey?) {
        this.pair = privateKey ? ECPair.fromPrivateKey(privateKey) : ECPair.makeRandom();
        this.privateKey = this.pair.privateKey;
        this.publicKey = this.pair.publicKey;
    }
    compressed: boolean;
    network: Network;
    lowR: boolean;
    privateKey?: Uint8Array;
    toWIF(): string {
        return this.pair.toWIF();
    }
    tweak(t: Uint8Array): ECPairInterface {
        return new ErrorPair(this.pair.tweak(t).privateKey);
    }
    verify(hash: Uint8Array, signature: Uint8Array): boolean {
        return this.pair.verify(hash, signature);
    }
    verifySchnorr(hash: Uint8Array, signature: Uint8Array): boolean {
        return this.pair.verifySchnorr(hash, signature);
    }
    signSchnorr(hash: Uint8Array): Uint8Array {
        return this.pair.signSchnorr(hexToUint8Array(hash256(uint8ArrayToHex(hash))));
    }
    publicKey: Uint8Array;
    sign(hash: Uint8Array, lowR?: boolean): Uint8Array {
        return this.pair.sign(hash, lowR);
    }
}

export class ErrorDefaultSigner implements Signer {
    constructor(private readonly keyPair: ECPairInterface = ECPair.makeRandom()) {}

    async getAddress(): Promise<string> {
        return this.getP2TRAddress();
    }

    async getPublicKey(): Promise<string> {
        return Promise.resolve(uint8ArrayToHex(this.keyPair.publicKey));
    }

    async signPsbt(psbtHex: string, options?: SignOptions): Promise<string> {
        const psbt = bitcoinjs.Psbt.fromHex(psbtHex);
        const { output } = bitcoinjs.payments.p2tr({
            address: this.getP2TRAddress(),
        });
        const taprootHex = uint8ArrayToHex(output!);

        const xpubkey = await this.getXOnlyPublicKey();
        const address = await this.getAddress();
        if (options) {
            const inputIndexSet = new Set<number>();
            options.toSignInputs.forEach((inputOpt) => {
                inputIndexSet.add(inputOpt.index);
                if (inputOpt.address && inputOpt.address !== address) {
                    return;
                }
                if (bitcoinjs.bip371.isTaprootInput(psbt.data.inputs[inputOpt.index])) {
                    const witnessUtxoScript = uint8ArrayToHex(psbt.data.inputs[inputOpt.index].witnessUtxo?.script);

                    if (witnessUtxoScript === taprootHex) {
                        // fee utxos
                        psbt.updateInput(inputOpt.index, {
                            tapInternalKey: hexToUint8Array(xpubkey),
                        });

                        const sighashTypes = inputOpt.sighashTypes || [bitcoinjs.Transaction.SIGHASH_DEFAULT];
                        psbt.signTaprootInput(
                            inputOpt.index,
                            this.getKeyPair(),
                            inputOpt.tapLeafHashToSign ? hexToUint8Array(inputOpt.tapLeafHashToSign!) : undefined,
                            sighashTypes,
                        );
                    } else {
                        // taproot Covenant
                        const sighashTypes = inputOpt.sighashTypes || [bitcoinjs.Transaction.SIGHASH_DEFAULT];
                        psbt.signTaprootInput(
                            inputOpt.index,
                            this.getKeyPair(),
                            inputOpt.tapLeafHashToSign ? hexToUint8Array(inputOpt.tapLeafHashToSign) : undefined,
                            sighashTypes,
                        );
                    }
                } else {
                    const sighashTypes = inputOpt.sighashTypes || [bitcoinjs.Transaction.SIGHASH_ALL];
                    psbt.signInput(inputOpt.index, this.keyPair, sighashTypes);
                }
            });
            // fee utxos
            for (let inputIdx = 0; inputIdx < psbt.inputCount; inputIdx++) {
                if (!inputIndexSet.has(inputIdx)) {
                    const input = psbt.data.inputs[inputIdx];
                    if (bitcoinjs.bip371.isTaprootInput(input)) {
                        const witnessUtxoScript = uint8ArrayToHex(psbt.data.inputs[inputIdx].witnessUtxo?.script);
                        if (witnessUtxoScript === taprootHex) {
                            psbt.updateInput(inputIdx, {
                                tapInternalKey: hexToUint8Array(xpubkey),
                            });
                            const sighashTypes = [bitcoinjs.Transaction.SIGHASH_DEFAULT];
                            psbt.signTaprootInput(inputIdx, this.getKeyPair(), undefined, sighashTypes);
                        }
                    } else {
                        psbt.signInput(inputIdx, this.keyPair, [bitcoinjs.Transaction.SIGHASH_ALL]);
                    }
                }
            }
        } else {
            psbt.data.inputs.forEach((input, inputIdx) => {
                if (bitcoinjs.bip371.isTaprootInput(input)) {
                    const witnessUtxoScript = uint8ArrayToHex(psbt.data.inputs[inputIdx].witnessUtxo?.script);

                    if (witnessUtxoScript === taprootHex) {
                        psbt.updateInput(inputIdx, {
                            tapInternalKey: hexToUint8Array(xpubkey),
                        });

                        const sighashTypes = [bitcoinjs.Transaction.SIGHASH_DEFAULT];
                        psbt.signTaprootInput(inputIdx, this.getKeyPair(), undefined, sighashTypes);
                    }
                } else {
                    psbt.signInput(inputIdx, this.keyPair, [bitcoinjs.Transaction.SIGHASH_ALL]);
                }
            });
        }
        return Promise.resolve(psbt.toHex());
    }
    signPsbts(reqs: { psbtHex: string; options?: SignOptions }[]): Promise<string[]> {
        return Promise.all(reqs.map((req) => this.signPsbt(req.psbtHex, req.options)));
    }

    private getKeyPair() {
        return this.getTweakedPrivateKey();
    }

    private getP2TRAddress(): string {
        const ketPair = ECPair.fromPrivateKey(this.getPrivateKey());
        const internalPubkey = ketPair.publicKey.subarray(1, 33);
        const { address } = bitcoinjs.payments.p2tr({
            internalPubkey: internalPubkey,
        });
        return address!;
    }

    private async getXOnlyPublicKey(): Promise<string> {
        const pubkey = await this.getPublicKey();
        return toXOnly(pubkey, true);
    }

    private getPrivateKey(): Uint8Array {
        return this.keyPair.privateKey;
    }

    private getTweakedPrivateKey(): ECPairInterface {
        const tweakHash = bitcoinjs.crypto.taggedHash('TapTweak', this.keyPair.publicKey.subarray(1, 33));
        return this.keyPair.tweak(tweakHash);
    }
}
