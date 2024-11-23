import { UTXO } from 'scrypt-ts';
import {
  ChainProvider,
  MempolChainProvider,
  MempoolUtxoProvider,
  RPCChainProvider,
  RPCUtxoProvider,
  UtxoProvider,
} from '@cat-protocol/cat-sdk';
import { ConfigService } from './configService';
import { WalletService } from './walletService';
export class FractalChainProvider implements ChainProvider {
  private chainProvider: ChainProvider | null = null;

  constructor(
    public config: ConfigService,
    public wallet: WalletService,
  ) {
    if (config.getRpc() !== null) {
      this.chainProvider = new RPCChainProvider(
        config.getRpcUrl(null),
        wallet.getWalletName(),
        config.getRpcUser(),
        config.getRpcPassword(),
      );
    } else {
      this.chainProvider = new MempolChainProvider(config.getNetwork());
    }
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
      this.utxoProvider = new RPCUtxoProvider(
        config.getRpcUrl(null),
        wallet.getWalletName(),
        config.getRpcUser(),
        config.getRpcPassword(),
      );
    } else {
      this.utxoProvider = new MempoolUtxoProvider(config.getNetwork());
    }
  }
  markSpent(txId: string, vout: number): void {
    this.utxoProvider.markSpent(txId, vout);
  }
  addNewUTXO(utxo: UTXO): void {
    this.utxoProvider.addNewUTXO(utxo);
  }

  async getUtxos(
    address: string,
    options?: { total?: number; maxCnt?: number },
  ): Promise<UTXO[]> {
    return this.utxoProvider.getUtxos(address, options);
  }
}

export function getProviders(config: ConfigService, wallet: WalletService) {
  return {
    utxoProvider: new FractalUtxoProvider(config, wallet),
    chainProvider: new FractalChainProvider(config, wallet),
  };
}
