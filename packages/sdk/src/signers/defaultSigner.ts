import * as ecc from '@bitcoinerlab/secp256k1';
import ECPairFactory, { ECPairInterface } from 'ecpair';
import { isTaprootInput, toXOnly } from '../lib/utils';
import { PSBTOptions, Signer } from '../lib/signer';
import { bitcoinjs } from '../lib/btc';
const ECPair = ECPairFactory(ecc);
bitcoinjs.initEccLib(ecc)

export enum AddressType {
    P2WPKH = 'p2wpkh',
    P2TR = 'p2tr',
}

export class DefaultSigner implements Signer {
    constructor(private readonly keyPair: ECPairInterface = ECPair.makeRandom(),
        private readonly addressType: AddressType = AddressType.P2TR) {

    }

    async getAddress(): Promise<string> {
        if (this.addressType === AddressType.P2TR) {
            return this.getP2TRAddress();
        } else if (this.addressType === AddressType.P2WPKH) {
            return this.getP2WPKHAddress();
        } else {
            throw new Error('Invalid addressType');
        }
    }

    async getPublicKey(): Promise<string> {
        return Promise.resolve(this.keyPair.publicKey.toString('hex'));
    }

    async signPsbt(psbtHex: string, options?: PSBTOptions): Promise<string> {
        const psbt = bitcoinjs.Psbt.fromHex(psbtHex);
        const { output } = bitcoinjs.payments.p2tr({
            address: this.getP2TRAddress()
        });
        const taprootHex = Buffer.from(output!).toString('hex');
        const xpubkey = await this.getXOnlyPublicKey();
        const address = await this.getAddress();
        if (options) {
            options.toSignInputs.forEach((inputOpt) => {
                if (inputOpt.address && inputOpt.address !== address) {
                    return
                }
                if (isTaprootInput(psbt.data.inputs[inputOpt.index])) {
                    const witnessUtxoScript = Buffer.from(
                        psbt.data.inputs[inputOpt.index].witnessUtxo?.script,
                    ).toString('hex');

                    if (witnessUtxoScript === taprootHex) { // fee utxos
                        psbt.updateInput(inputOpt.index, {
                            tapInternalKey: Buffer.from(xpubkey, 'hex'),
                        });

                        const sighashTypes = inputOpt.sighashTypes || [
                            bitcoinjs.Transaction.SIGHASH_DEFAULT,
                        ];
                        psbt.signTaprootInput(
                            inputOpt.index,
                            this.getKeyPair(),
                            inputOpt.tapLeafHashToSign
                                ? Buffer.from(inputOpt.tapLeafHashToSign, 'hex')
                                : undefined,
                            sighashTypes,
                        );
                    } else {
                        // taproot Covenant
                        const sighashTypes = inputOpt.sighashTypes || [
                            bitcoinjs.Transaction.SIGHASH_DEFAULT,
                        ];
                        psbt.signTaprootInput(
                            inputOpt.index,
                            this.getKeyPair(),
                            inputOpt.tapLeafHashToSign
                                ? Buffer.from(inputOpt.tapLeafHashToSign, 'hex')
                                : undefined,
                            sighashTypes,
                        );
                    }
                } else {
                    const sighashTypes = inputOpt.sighashTypes || [
                        bitcoinjs.Transaction.SIGHASH_ALL,
                    ];
                    psbt.signInput(inputOpt.index, this.keyPair, sighashTypes);
                }
            });
        } else {
            psbt.data.inputs.forEach((input, inputIdx) => {
                if (isTaprootInput(input)) {
                    const witnessUtxoScript = Buffer.from(
                        psbt.data.inputs[inputIdx].witnessUtxo?.script,
                    ).toString('hex');

                    if (witnessUtxoScript === taprootHex) {
                        psbt.updateInput(inputIdx, {
                            tapInternalKey: Buffer.from(xpubkey, 'hex'),
                        });

                        const sighashTypes = [bitcoinjs.Transaction.SIGHASH_DEFAULT];
                        psbt.signTaprootInput(
                            inputIdx,
                            this.getKeyPair(),
                            undefined,
                            sighashTypes,
                        );
                    }
                } else {
                    psbt.signInput(inputIdx, this.keyPair, [
                        bitcoinjs.Transaction.SIGHASH_ALL,
                    ]);
                }
            });
        }
        return Promise.resolve(psbt.toHex());
    }
    signPsbts(
        reqs: { psbtHex: string; options?: PSBTOptions }[],
    ): Promise<string[]> {
        return Promise.all(
            reqs.map((req) => this.signPsbt(req.psbtHex, req.options)),
        );
    }

    private getKeyPair() {
        if (this.addressType === AddressType.P2TR) {
            return ECPair.fromPrivateKey(this.getTweakedPrivateKey());
        } else if (this.addressType === AddressType.P2WPKH) {
            return this.keyPair;
        } else {
            throw new Error('Invalid addressType');
        }
    }


    private getP2TRAddress(): string {
        const ketPair = ECPair.fromPrivateKey(this.getPrivateKey());
        const internalPubkey = ketPair.publicKey.subarray(1, 33);
        const { address } = bitcoinjs.payments.p2tr({
            internalPubkey: internalPubkey
        });
        return address!
    }

    private getP2WPKHAddress(): string {
        const pubkey = this.keyPair.publicKey;
        const { address } = bitcoinjs.payments.p2wpkh({
            pubkey: pubkey,
        });
        return address!
    }

    private async getXOnlyPublicKey(): Promise<string> {
        const pubkey = await this.getPublicKey();
        return toXOnly(pubkey, this.addressType === AddressType.P2WPKH);
    }

    private getPrivateKey(): Buffer {
        return this.keyPair.privateKey
    }

    private getTweakedPrivateKey(): Buffer {

        // Order of the curve (N) - 1
        const N_LESS_1 = Buffer.from(
            'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140',
            'hex'
        );
        // 1 represented as 32 bytes BE
        const ONE = Buffer.from(
            '0000000000000000000000000000000000000000000000000000000000000001',
            'hex'
        );

        const privateKey =
            this.keyPair.publicKey[0] === 2
                ? this.keyPair.privateKey
                : ecc.privateAdd(ecc.privateSub(N_LESS_1, this.keyPair.privateKey), ONE);
        const tweakHash = bitcoinjs.crypto.taggedHash(
            'TapTweak',
            this.keyPair.publicKey.subarray(1, 33)
        );
        return Buffer.from(ecc.privateAdd(privateKey, tweakHash));
    }
}
