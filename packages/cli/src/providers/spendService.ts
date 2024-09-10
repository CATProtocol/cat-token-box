import { Inject, Injectable } from '@nestjs/common';
import { UTXO } from 'scrypt-ts';
import { ConfigService } from './configService';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { logerror, btc } from 'src/common';

@Injectable()
export class SpendService {
  private spends: Set<string> = new Set<string>();
  private _blockHeight = 0;
  constructor(@Inject() private readonly configService: ConfigService) {
    this.loadSpends();
  }

  loadSpends() {
    const dataDir = this.configService.getDataDir();
    const spendFile = join(dataDir, 'spends.json');
    let spendString = null;

    try {
      spendString = readFileSync(spendFile).toString();
    } catch (error) {
      if (!existsSync(spendFile)) {
        return;
      }
      logerror(`read spend file: ${spendFile} failed!`, error);
      return;
    }

    try {
      const json = JSON.parse(spendString);

      const { blockHeight, spends } = json;
      this._blockHeight = blockHeight;

      for (const spend of spends) {
        this.addSpend(spend);
      }
    } catch (error) {
      logerror(`parse spend file failed!`, error);
    }
  }

  addSpend(spend: UTXO | string) {
    if (typeof spend === 'string') {
      this.spends.add(spend);
    } else {
      const utxo = spend as UTXO;
      this.spends.add(`${utxo.txId}:${utxo.outputIndex}`);
    }
  }

  isUnspent(utxo: UTXO | string): boolean {
    if (typeof utxo === 'string') {
      return !this.spends.has(utxo);
    }
    return !this.spends.has(`${utxo.txId}:${utxo.outputIndex}`);
  }

  updateSpends(tx: btc.Transaction) {
    for (let i = 0; i < tx.inputs.length - 1; i++) {
      const input = tx.inputs[i];
      this.addSpend(`${input.prevTxId.toString('hex')}:${input.outputIndex}`);
    }
  }

  updateTxsSpends(txs: btc.Transaction[]) {
    for (let i = 0; i < txs.length - 1; i++) {
      this.updateSpends(txs[i]);
    }
  }

  blockHeight(): number {
    return this._blockHeight;
  }

  reset() {
    this.spends.clear();
  }

  updateBlockHeight(blockHeight: number): void {
    this._blockHeight = blockHeight;
  }

  save(): void {
    const dataDir = this.configService.getDataDir();
    const spendsFile = join(dataDir, 'spends.json');
    try {
      writeFileSync(
        spendsFile,
        JSON.stringify(
          {
            blockHeight: this._blockHeight,
            spends: Array.from(this.spends),
          },
          null,
          1,
        ),
      );
      return null;
    } catch (error) {
      logerror(`write spends file: ${spendsFile} failed!`, error);
    }
  }
}
