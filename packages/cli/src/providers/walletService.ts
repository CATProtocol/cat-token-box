import * as bip39 from 'bip39';
import BIP32Factory, { BIP32Interface } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import { Inject, Injectable } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  AddressType,
  logerror,
  rpc_create_watchonly_wallet,
  rpc_importdescriptors,
  Wallet,
} from 'src/common';
import { ConfigService } from './configService';
import { join } from 'path';
import { DefaultSigner, btc, Signer, PSBTOptions } from '@cat-protocol/cat-sdk';
import ECPairFactory from 'ecpair';
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

@Injectable()
export class WalletService implements Signer {
  private wallet: Wallet | null = null;
  private signer: DefaultSigner | null = null;
  constructor(@Inject() private readonly configService: ConfigService) {}
  getAddress(): Promise<string> {
    if (this.signer === null) {
      throw new Error('wallet unload!');
    }

    return this.signer.getAddress();
  }
  getPublicKey(): Promise<string> {
    if (this.signer === null) {
      throw new Error('wallet unload!');
    }

    return this.signer.getPublicKey();
  }
  signPsbt(psbtHex: string, options?: PSBTOptions): Promise<string> {
    if (this.signer === null) {
      throw new Error('wallet unload!');
    }

    return this.signer.signPsbt(psbtHex, options);
  }
  signPsbts(
    reqs: { psbtHex: string; options?: PSBTOptions }[],
  ): Promise<string[]> {
    if (this.signer === null) {
      throw new Error('wallet unload!');
    }

    return this.signer.signPsbts(reqs);
  }

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
      const ketPair = ECPair.fromPrivateKey(this.getPrivateKey());
      this.signer = new DefaultSigner(ketPair, this.getAddressType());
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

  getPrivateKey(derivePath?: string): Buffer {
    const mnemonic = this.getMnemonic();
    const network = btc.Networks.mainnet;
    return derivePrivateKey(
      mnemonic,
      derivePath || this.getAccountPath(),
      network,
    ).privateKey;
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

    const address = await this.getAddress();
    const importError = await rpc_importdescriptors(
      this.configService,
      this.wallet.name,
      `addr(${address})`,
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
}

function derivePrivateKey(
  mnemonic: string,
  path: string,
  network: btc.Network,
): BIP32Interface {
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
  return root.derivePath(path);
}
