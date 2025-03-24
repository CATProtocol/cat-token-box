import { Injectable, Logger } from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { TxInput, payments, Transaction, script } from 'bitcoinjs-lib';
import { CachedContent, TaprootPayment, TokenTypeScope } from '../../common/types';
import { CommonService } from '../../services/common/common.service';
import { Constants } from '../../common/constants';
import { parseEnvelope } from '../../common/utils';
import { LRUCache } from 'lru-cache';

@Injectable()
export class TxService {
  private readonly logger = new Logger(TxService.name);

  private static readonly contentCache = new LRUCache<string, CachedContent>({
    max: Constants.CACHE_MAX_SIZE,
  });

  constructor(
    private readonly commonService: CommonService,
    private readonly tokenService: TokenService,
  ) {}

  async parseTransferTxTokenOutputs(txid: string) {
    const raw = await this.commonService.getRawTx(txid);
    const tx = Transaction.fromHex(raw);
    const payIns = tx.ins.map((input) => this.parseTaprootInput(input));
    const payOuts = tx.outs.map((output) => this.commonService.parseTaprootOutput(output));
    const guardInputs = this.commonService.searchGuardInputs(payIns);
    if (guardInputs.length === 0) {
      throw new Error('not a token transfer tx');
    }
    const outputs = [];
    for (const guardInput of guardInputs) {
      const tokenOutputs = this.commonService.parseTransferTxTokenOutputs(guardInput);
      if (tokenOutputs.size > 0) {
        const isFungible = this.commonService.isFungibleGuard(guardInput);
        outputs.push(
          ...(await Promise.all(
            [...tokenOutputs.keys()].map(async (i) => {
              const tokenInfo = await this.tokenService.getTokenInfoByTokenPubKey(
                payOuts[i].pubkey.toString('hex'),
                isFungible ? TokenTypeScope.Fungible : TokenTypeScope.NonFungible,
              );
              const tokenOutput = tokenOutputs.get(i);
              return Object.assign(
                {},
                {
                  outputIndex: i,
                  ownerPubKeyHash: tokenOutput.ownerPubKeyHash,
                },
                isFungible
                  ? {
                      tokenAmount: tokenOutput.tokenAmount,
                      tokenId: tokenInfo.tokenId,
                    }
                  : {
                      localId: tokenOutput.tokenAmount,
                      collectionId: tokenInfo.tokenId,
                    },
              );
            }),
          )),
        );
      }
    }
    return { outputs };
  }

  /**
   * Parse taproot input from tx input, returns null if failed
   */
  private parseTaprootInput(input: TxInput): TaprootPayment | null {
    try {
      const taproot = payments.p2tr({ witness: input.witness });
      return {
        pubkey: taproot.pubkey ? Buffer.from(taproot.pubkey) : undefined,
        redeemScript: taproot?.redeem?.output ? Buffer.from(taproot.redeem.output) : undefined,
        witness: input.witness.map((w) => Buffer.from(w)),
      };
    } catch {
      return null;
    }
  }

  decodeDelegate(delegate: Buffer): { txId: string; inputIndex: number } | undefined {
    try {
      const buf = Buffer.concat([delegate, Buffer.from([0x00, 0x00, 0x00, 0x00])]);
      const txId = buf.subarray(0, 32).reverse().toString('hex');
      const inputIndex = buf.subarray(32, 36).readUInt32LE();
      return { txId, inputIndex };
    } catch (e) {
      this.logger.error(`decode delegate error: ${e.message}`);
    }
    return undefined;
  }

  public async getDelegateContent(delegate: Buffer): Promise<CachedContent | null> {
    const { txId, inputIndex } = this.decodeDelegate(delegate) || {};
    const key = `${txId}_${inputIndex}`;
    let cached = TxService.contentCache.get(key);
    if (!cached) {
      const raw = await this.commonService.getRawTx(txId, true);
      const tx = Transaction.fromHex(raw['hex']);
      if (inputIndex < tx.ins.length) {
        const payIn = this.parseTaprootInput(tx.ins[inputIndex]);
        const content = await this.parseContentEnvelope(payIn?.redeemScript);
        if (content) {
          cached = content;
          if (Number(raw['confirmations']) >= Constants.CACHE_AFTER_N_BLOCKS) {
            TxService.contentCache.set(key, cached);
          }
        }
      }
    }
    return cached;
  }

  async parseContentEnvelope(redeemScript: Buffer): Promise<CachedContent | null> {
    try {
      const asm = script.toASM(redeemScript || Buffer.alloc(0));
      const match = asm.match(Constants.CONTENT_ENVELOPE);
      if (match && match[1]) {
        const data = parseEnvelope(match[1]);
        if (data && data.content) {
          if (data.content.type === Constants.CONTENT_TYPE_CAT721_DELEGATE_V1) {
            return this.getDelegateContent(data.content.raw);
          }
          return data.content;
        }
      }
    } catch (e) {
      this.logger.error(`parse content envelope error, ${e.message}`);
    }
    return null;
  }
}
