import { Injectable, Logger } from '@nestjs/common';
import { RpcService } from '../rpc/rpc.service';
import { BlockEntity } from '../../entities/block.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Constants } from '../../common/constants';
import { TaprootPayment } from '../../common/types';
import { TxOutput } from 'bitcoinjs-lib';
import { CAT20GuardCovenant, CAT721GuardCovenant } from '@cat-protocol/cat-sdk-v2';

@Injectable()
export class CommonService {
  private readonly logger = new Logger(CommonService.name);

  public readonly FT_GUARD_PUBKEY: string;
  public readonly NFT_GUARD_PUBKEY: string;

  constructor(
    private readonly rpcService: RpcService,
    @InjectRepository(BlockEntity)
    private blockEntityRepository: Repository<BlockEntity>,
  ) {
    const tokenGuardContractInfo = new CAT20GuardCovenant();
    this.FT_GUARD_PUBKEY = tokenGuardContractInfo.tpubkey;
    this.logger.log(`token guard xOnlyPubKey = ${this.FT_GUARD_PUBKEY}`);

    const nftGuardContractInfo = new CAT721GuardCovenant();
    this.NFT_GUARD_PUBKEY = nftGuardContractInfo.tpubkey;
    this.logger.log(`nft guard xOnlyPubKey = ${this.NFT_GUARD_PUBKEY}`);
  }

  public async getLastProcessedBlock(): Promise<BlockEntity | null> {
    const blocks = await this.blockEntityRepository.find({
      take: 1,
      order: { height: 'DESC' },
    });
    return blocks[0] || null;
  }

  public async getLastProcessedBlockHeight(): Promise<number | null> {
    const block = await this.getLastProcessedBlock();
    return block?.height || null;
  }

  public async getBlockchainInfo() {
    const resp = await this.rpcService.getBlockchainInfo();
    return resp?.data?.result;
  }

  /**
   * Parse token outputs from guard input of a transfer tx
   */
  public parseTransferTxTokenOutputs(guardInput: TaprootPayment) {
    const ownerPubKeyHashes = guardInput.witness.slice(
      Constants.GUARD_ADDR_OFFSET,
      Constants.GUARD_ADDR_OFFSET + Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    const tokenAmounts = guardInput.witness.slice(
      Constants.GUARD_AMOUNT_OFFSET,
      Constants.GUARD_AMOUNT_OFFSET + Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    const masks = guardInput.witness.slice(
      Constants.GUARD_MASK_OFFSET,
      Constants.GUARD_MASK_OFFSET + Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    const tokenOutputs = new Map<
      number,
      {
        ownerPubKeyHash: string;
        tokenAmount: bigint;
      }
    >();
    for (let i = 0; i < Constants.CONTRACT_OUTPUT_MAX_COUNT; i++) {
      if (masks[i].toString('hex') !== '81') {
        const ownerPubKeyHash = ownerPubKeyHashes[i].toString('hex');
        const tokenAmount =
          tokenAmounts[i].length === 0 ? 0n : BigInt(tokenAmounts[i].readIntLE(0, tokenAmounts[i].length));
        tokenOutputs.set(i + 1, {
          ownerPubKeyHash,
          tokenAmount,
        });
      }
    }
    return tokenOutputs;
  }

  /**
   * Parse taproot output from tx output, returns null if failed
   */
  public parseTaprootOutput(output: TxOutput): TaprootPayment | null {
    try {
      if (
        output.script.length !== Constants.TAPROOT_LOCKING_SCRIPT_LENGTH ||
        !Buffer.from(output.script).toString('hex').startsWith('5120')
      ) {
        return null;
      }
      return {
        pubkey: Buffer.from(output.script.subarray(2, 34)),
        redeemScript: null,
        witness: null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Search Guard in tx outputs
   * @returns true if found Guard tx outputs, false otherwise
   */
  public searchGuardOutputs(payOuts: TaprootPayment[]): boolean {
    for (const payOut of payOuts) {
      if (
        this.FT_GUARD_PUBKEY === payOut?.pubkey?.toString('hex') ||
        this.NFT_GUARD_PUBKEY === payOut?.pubkey?.toString('hex')
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Search Guard in tx inputs
   * @returns array of Guard inputs
   */
  public searchGuardInputs(payIns: TaprootPayment[]): TaprootPayment[] {
    return payIns.filter((payIn) => {
      return (
        this.FT_GUARD_PUBKEY === payIn?.pubkey?.toString('hex') ||
        this.NFT_GUARD_PUBKEY === payIn?.pubkey?.toString('hex')
      );
    });
  }

  public isFungibleGuard(guardInput: TaprootPayment): boolean {
    return this.FT_GUARD_PUBKEY === guardInput?.pubkey?.toString('hex');
  }

  public async getRawTx(txid: string, verbose: boolean = false): Promise<string | undefined> {
    const resp = await this.rpcService.getRawTx(txid, verbose);
    return resp?.data?.result;
  }
}
