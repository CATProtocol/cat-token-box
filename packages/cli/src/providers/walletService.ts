// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import btc = require('bitcore-lib-inquisition');
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { Inject, Injectable } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  AddressType,
  logerror,
  rpc_create_watchonly_wallet,
  rpc_importdescriptors,
  toXOnly,
  Wallet,
} from 'src/common';
import { ConfigService } from './configService';
import { join } from 'path';
import { hash160 } from 'scrypt-ts';

const bip32 = BIP32Factory(ecc);

@Injectable()
export class WalletService {
  private wallet: Wallet | null = null;
  constructor(@Inject() private readonly configService: ConfigService) {}

  checkWalletJson(obj: any) {
    if (typeof obj.name === 'undefined') {
      throw new Error('No "name" found in wallet.json!');
    }

    if (typeof obj.name !== 'string') {
      throw new Error('"name" in wallet.json should be string!');
    }

    if (typeof obj.mnemonic === 'undefined') {
      throw new Error('No "mnemonic" found in wallet.json!');
    }

    if (typeof obj.mnemonic !== 'string') {
      throw new Error('"mnemonic" in wallet.json should be string!');
    }

    if (!bip39.validateMnemonic(obj.mnemonic)) {
      throw new Error('Invalid mnemonic in wallet.json!');
    }

    if (typeof obj.accountPath === 'undefined') {
      throw new Error('No "accountPath" found in wallet.json!');
    }

    if (typeof obj.accountPath !== 'string') {
      throw new Error('"accountPath" in wallet.json should be string!');
    }
  }

  loadWallet(): Wallet | null {
    const dataDir = this.configService.getDataDir();
    const walletFile = join(dataDir, 'wallet.json');
    let walletString = null;

    try {
      walletString = readFileSync(walletFile).toString();
    } catch (error) {
      if (!existsSync(walletFile)) {
        logerror(
          `wallet file: ${walletFile} not exists!`,
          new Error("run 'wallet create' command to create a wallet."),
        );
      } else {
        logerror(`read wallet file: ${walletFile} failed!`, error);
      }
      return null;
    }

    try {
      const wallet = JSON.parse(walletString);
      this.checkWalletJson(wallet);
      this.wallet = wallet;
      return wallet;
    } catch (error) {
      logerror(`parse wallet file failed!`, error);
    }

    return null;
  }

  getWallet() {
    return this.wallet;
  }

  getWalletName() {
    return this.wallet.name;
  }

  getAddressType = () => {
    const wallet = this.getWallet();
    if (wallet === null) {
      throw new Error("run 'create wallet' command to create a wallet.");
    }
    return wallet.addressType || AddressType.P2TR;
  };

  getAccountPath = () => {
    const wallet = this.getWallet();
    if (wallet === null) {
      throw new Error("run 'create wallet' command to create a wallet.");
    }
    return wallet.accountPath || '';
  };

  getMnemonic = () => {
    const wallet = this.getWallet();
    if (wallet === null) {
      throw new Error("run 'create wallet' command to create a wallet.");
    }
    return wallet.mnemonic;
  };

  getWif(): string {
    return this.getPrivateKey().toWIF();
  }

  getPrivateKey(derivePath?: string): btc.PrivateKey {
    const mnemonic = this.getMnemonic();
    const network = btc.Networks.mainnet;
    return derivePrivateKey(
      mnemonic,
      derivePath || this.getAccountPath(),
      network,
    );
  }

  /**
   * Generate a derive path from the given seed
   */
  generateDerivePath(seed: string): string {
    const path = ['m'];
    const hash = Buffer.from(hash160(seed), 'hex');
    for (let i = 0; i < hash.length; i += 4) {
      let index = hash.readUint32BE(i);
      let hardened = '';
      if (index >= 0x80000000) {
        index -= 0x80000000;
        hardened = "'";
      }
      path.push(`${index}${hardened}`);
    }
    return path.join('/');
  }

  getP2TRAddress(): btc.Address {
    return this.getPrivateKey().toAddress(null, btc.Address.PayToTaproot);
  }

  getAddress(): btc.Address {
    return this.getP2TRAddress();
  }

  getXOnlyPublicKey(): string {
    const pubkey = this.getPublicKey();
    return toXOnly(pubkey.toBuffer()).toString('hex');
  }

  getTweakedPrivateKey(): btc.PrivateKey {
    const { tweakedPrivKey } = this.getPrivateKey().createTapTweak();
    return btc.PrivateKey.fromBuffer(tweakedPrivKey);
  }

  getPublicKey(): btc.PublicKey {
    const addressType = this.getAddressType();

    if (addressType === AddressType.P2TR) {
      return this.getTweakedPrivateKey().toPublicKey();
    } else if (addressType === AddressType.P2WPKH) {
      return this.getPrivateKey().toPublicKey();
    }
  }

  getPubKeyPrefix(): string {
    const addressType = this.getAddressType();
    if (addressType === AddressType.P2TR) {
      return '';
    } else if (addressType === AddressType.P2WPKH) {
      const pubkey = this.getPublicKey();
      return pubkey.toString().slice(0, 2);
    }
  }

  getTokenAddress(): string {
    const addressType = this.getAddressType();

    if (addressType === AddressType.P2TR) {
      const xpubkey = this.getXOnlyPublicKey();
      return hash160(xpubkey);
    } else if (addressType === AddressType.P2WPKH) {
      const pubkey = this.getPublicKey();
      return hash160(pubkey.toString());
    } else {
      throw new Error(`Unsupported address type: ${addressType}`);
    }
  }

  getTaprootPrivateKey(): string {
    return this.getTweakedPrivateKey();
  }

  getTokenPrivateKey(): string {
    const addressType = this.getAddressType();

    if (addressType === AddressType.P2TR) {
      return this.getTaprootPrivateKey();
    } else if (addressType === AddressType.P2WPKH) {
      return this.getPrivateKey();
    } else {
      throw new Error(`Unsupported address type: ${addressType}`);
    }
  }

  createWallet(wallet: Wallet): Error | null {
    const dataDir = this.configService.getDataDir();
    const walletFile = join(dataDir, 'wallet.json');
    try {
      writeFileSync(walletFile, JSON.stringify(wallet, null, 2));
      this.wallet = wallet;
      return null;
    } catch (error) {
      logerror(`write wallet file: ${walletFile} failed!`, error);
      return error;
    }
  }

  async importWallet(create: boolean = false): Promise<boolean> {
    if (create) {
      const e = await rpc_create_watchonly_wallet(
        this.configService,
        this.wallet.name,
      );
      if (e instanceof Error) {
        logerror('rpc_create_watchonly_wallet failed!', e);
        return false;
      }
    }
    const importError = await rpc_importdescriptors(
      this.configService,
      this.wallet.name,
      `addr(${this.getAddress()})`,
    );

    if (importError instanceof Error) {
      logerror('rpc_importdescriptors failed!', importError);
      return false;
    }

    return true;
  }

  foundWallet(): string | null {
    const dataDir = this.configService.getDataDir();
    const walletFile = join(dataDir, 'wallet.json');
    let walletString = null;

    try {
      walletString = readFileSync(walletFile).toString();
      JSON.parse(walletString);
      return walletFile;
    } catch (error) {}

    return null;
  }

  signTx(tx: btc.Transaction) {
    // unlock fee inputs

    const privateKey = this.getPrivateKey();
    const hashData = btc.crypto.Hash.sha256ripemd160(
      privateKey.publicKey.toBuffer(),
    );

    for (let i = 0; i < tx.inputs.length; i++) {
      const input = tx.inputs[i];
      if (input.output.script.isWitnessPublicKeyHashOut()) {
        const signatures = input.getSignatures(
          tx,
          privateKey,
          i,
          undefined,
          hashData,
          undefined,
          undefined,
        );

        tx.applySignature(signatures[0]);
      } else if (input.output.script.isTaproot() && !input.hasWitnesses()) {
        const signatures = input.getSignatures(
          tx,
          privateKey,
          i,
          btc.crypto.Signature.SIGHASH_ALL,
          hashData,
          undefined,
          undefined,
        );

        tx.applySignature(signatures[0]);
      }
    }
  }
}

function derivePrivateKey(
  mnemonic: string,
  path: string,
  network: btc.Network,
): btc.PrivateKey {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const mainnet = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'bc',
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4,
    },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
  };
  const testnet = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'tb',
    bip32: {
      public: 0x043587cf,
      private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
  };

  const root = bip32.fromSeed(
    seed,
    network === btc.Networks.mainnet ? mainnet : testnet,
  );
  const wif = root.derivePath(path).toWIF();
  return new btc.PrivateKey(wif, network);
}
