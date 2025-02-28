import { Injectable, Logger } from '@nestjs/common';
import { RpcService } from '../rpc/rpc.service';
import { BlockEntity } from '../../entities/block.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Constants } from '../../common/constants';
import { TaprootPayment } from '../../common/types';
import { TxOutput, crypto } from 'bitcoinjs-lib';
import {
  Cat20GuardCovenant,
  CAT721GuardCovenant,
} from '@cat-protocol/cat-sdk-v2';

@Injectable()
export class CommonService {
  private readonly logger = new Logger(CommonService.name);

  public readonly FT_GUARD_PUBKEY: string;
  public readonly FT_TRANSFER_GUARD_SCRIPT_HASH: string;

  public readonly NFT_GUARD_PUBKEY: string;
  public readonly NFT_TRANSFER_GUARD_SCRIPT_HASH: string;

  constructor(
    private readonly rpcService: RpcService,
    @InjectRepository(BlockEntity)
    private blockEntityRepository: Repository<BlockEntity>,
  ) {
    const tokenGuardContractInfo = new Cat20GuardCovenant();
    this.FT_GUARD_PUBKEY = tokenGuardContractInfo.tpubkey;
    this.FT_TRANSFER_GUARD_SCRIPT_HASH =
      tokenGuardContractInfo.getTapLeafContract().contractScriptHash;
    this.logger.log(`token guard xOnlyPubKey = ${this.FT_GUARD_PUBKEY}`);
    this.logger.log(
      `token guard transferScriptHash = ${this.FT_TRANSFER_GUARD_SCRIPT_HASH}`,
    );

    const nftGuardContractInfo = new CAT721GuardCovenant();
    this.NFT_GUARD_PUBKEY = nftGuardContractInfo.tpubkey;
    this.NFT_TRANSFER_GUARD_SCRIPT_HASH =
      nftGuardContractInfo.getTapLeafContract().contractScriptHash;
    this.logger.log(`nft guard xOnlyPubKey = ${this.NFT_GUARD_PUBKEY}`);
    this.logger.log(
      `nft guard transferScriptHash = ${this.NFT_TRANSFER_GUARD_SCRIPT_HASH}`,
    );
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
      Constants.TRANSFER_GUARD_ADDR_OFFSET,
      Constants.TRANSFER_GUARD_ADDR_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    const tokenAmounts = guardInput.witness.slice(
      Constants.TRANSFER_GUARD_AMOUNT_OFFSET,
      Constants.TRANSFER_GUARD_AMOUNT_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    const masks = guardInput.witness.slice(
      Constants.TRANSFER_GUARD_MASK_OFFSET,
      Constants.TRANSFER_GUARD_MASK_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
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
          tokenAmounts[i].length === 0
            ? 0n
            : BigInt(tokenAmounts[i].readIntLE(0, tokenAmounts[i].length));
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

  public isTransferGuard(guardInput: TaprootPayment): boolean {
    return (
      this.isFtTransferGuard(guardInput) || this.isNftTransferGuard(guardInput)
    );
  }

  public guardScriptHash(guardInput: TaprootPayment): string {
    return Buffer.from(
      crypto.hash160(guardInput?.redeemScript || Buffer.alloc(0)),
    ).toString('hex');
  }

  public isFtTransferGuard(guardInput: TaprootPayment): boolean {
    return (
      this.guardScriptHash(guardInput) === this.FT_TRANSFER_GUARD_SCRIPT_HASH
    );
  }

  public isNftTransferGuard(guardInput: TaprootPayment): boolean {
    return (
      this.guardScriptHash(guardInput) === this.NFT_TRANSFER_GUARD_SCRIPT_HASH
    );
  }
}
