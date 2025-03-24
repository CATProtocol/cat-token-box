import {
  ChainProvider,
  MempoolProvider,
  RPCProvider,
  UTXO,
  UtxoProvider,
  UtxoQueryOptions,
} from '@scrypt-inc/scrypt-ts-btc';

import { ConfigService } from './configService';
import { WalletService } from './walletService';
export class FractalChainProvider implements ChainProvider {
  private chainProvider: ChainProvider | null = null;

  constructor(
    public config: ConfigService,
    public wallet: WalletService,
  ) {
    if (config.getRpc() !== null) {
      this.chainProvider = new RPCProvider(
        config.getRpcUrl(null),
        wallet.getWalletName(),
        config.getRpcUser(),
        config.getRpcPassword(),
      );
    } else {
      this.chainProvider = new MempoolProvider(config.getNetwork());
    }
  }
  getFeeRate(): Promise<number> {
    return this.chainProvider.getFeeRate();
  }
  async getConfirmations(txId: string): Promise<number> {
    return this.chainProvider.getConfirmations(txId);
  }

  async broadcast(txHex: string): Promise<string> {
    return this.chainProvider.broadcast(txHex);
  }

  async getRawTransaction(txId: string): Promise<string> {
    return this.chainProvider.getRawTransaction(txId);
  }
}

export class FractalUtxoProvider implements UtxoProvider {
  private utxoProvider: UtxoProvider | null = null;

  constructor(
    public config: ConfigService,
    public wallet: WalletService,
  ) {
    if (config.getRpc() !== null) {
      this.utxoProvider = new RPCProvider(
        config.getRpcUrl(null),
        wallet.getWalletName(),
        config.getRpcUser(),
        config.getRpcPassword(),
      );
    } else {
      this.utxoProvider = new MempoolProvider(config.getNetwork());
    }
  }
  getUtxos(address: string, options?: UtxoQueryOptions): Promise<UTXO[]> {
    return this.utxoProvider.getUtxos(address, options);
  }
  markSpent(txId: string, vout: number): void {
    this.utxoProvider.markSpent(txId, vout);
  }
  addNewUTXO(utxo: UTXO): void {
    this.utxoProvider.addNewUTXO(utxo);
  }
}

export function getProviders(config: ConfigService, wallet: WalletService) {
  return {
    utxoProvider: new FractalUtxoProvider(config, wallet),
    chainProvider: new FractalChainProvider(config, wallet),
  };
}
