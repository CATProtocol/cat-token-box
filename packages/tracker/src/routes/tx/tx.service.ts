import { Injectable } from '@nestjs/common';
import { TokenService } from '../token/token.service';
import { network as _network } from '../../common/constants';
import { ChainProvider, MempolChainProvider } from '@cat-protocol/cat-sdk';
import { networks, TxInput, payments, Transaction } from 'bitcoinjs-lib';
import { TaprootPayment, TokenTypeScope } from '../../common/types';
import { CommonService } from '../../services/common/common.service';
import { InjectRepository } from '@nestjs/typeorm';
import { TxOutEntity } from '../../entities/txOut.entity';
import { Repository } from 'typeorm';

@Injectable()
export class TxService {
  private readonly provider: ChainProvider;

  constructor(
    private readonly commonService: CommonService,
    private readonly tokenService: TokenService,
    @InjectRepository(TxOutEntity)
    private readonly txOutRepository: Repository<TxOutEntity>,
  ) {
    this.provider = new MempolChainProvider(
      _network === networks.bitcoin ? 'fractal-mainnet' : 'fractal-testnet',
    );
  }

  async getTx(txid: string) {
    const raw = await this.getRawTx(txid);
    const tx = Transaction.fromHex(raw);
    const payIns = tx.ins.map((input) => this.parseTaprootInput(input));
    const payOuts = tx.outs.map((output) =>
      this.commonService.parseTaprootOutput(output),
    );
    const guardInputs = this.commonService.searchGuardInputs(payIns);
    if (guardInputs.length === 0) {
      throw new Error('not a token transfer tx');
    }
    const outputs = [];
    for (const guardInput of guardInputs) {
      if (this.commonService.isTransferGuard(guardInput)) {
        const tokenOutputs =
          this.commonService.parseTransferTxTokenOutputs(guardInput);
        const isFungible = this.commonService.isFtTransferGuard(guardInput);
        outputs.push(
          ...(await Promise.all(
            [...tokenOutputs.keys()].map(async (i) => {
              const tokenInfo =
                await this.tokenService.getTokenInfoByTokenPubKey(
                  payOuts[i].pubkey.toString('hex'),
                  isFungible
                    ? TokenTypeScope.Fungible
                    : TokenTypeScope.NonFungible,
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

  async getRawTx(txid: string): Promise<string> {
    try {
      return this.provider.getRawTransaction(txid);
    } catch (e) {
      throw new Error(`error getting raw tx, ${e.message}`);
    }
  }

  /**
   * Parse taproot input from tx input, returns null if failed
   */
  private parseTaprootInput(input: TxInput): TaprootPayment | null {
    try {
      const taproot = payments.p2tr({ witness: input.witness });
      return {
        pubkey: taproot.pubkey ? Buffer.from(taproot.pubkey) : undefined,
        redeemScript: taproot?.redeem?.output
          ? Buffer.from(taproot.redeem.output)
          : undefined,
        witness: input.witness.map((w) => Buffer.from(w)),
      };
    } catch {
      return null;
    }
  }

  async getTxOut(txid: string, outputIndex: number) {
    return this.txOutRepository.findOne({
      where: {
        txid,
        outputIndex,
      },
    });
  }
}
