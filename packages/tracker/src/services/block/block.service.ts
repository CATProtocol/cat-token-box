import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../../common/utils';
import { RpcService } from '../rpc/rpc.service';
import { BlockEntity } from '../../entities/block.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { Block } from 'bitcoinjs-lib';
import { TxService } from '../tx/tx.service';
import { BlockHeader } from '../../common/types';
import { Constants } from '../../common/constants';

@Injectable()
export class BlockService implements OnModuleInit {
  private readonly logger = new Logger(BlockService.name);
  private readonly genesisBlockHeight: number;

  constructor(
      private dataSource: DataSource,
      private readonly rpcService: RpcService,
      private readonly txService: TxService,
      private configService: ConfigService,
      @InjectRepository(BlockEntity)
      private blockEntityRepository: Repository<BlockEntity>,
  ) {
    this.genesisBlockHeight = this.configService.get('genesisBlockHeight');
  }

  async onModuleInit() {
    await this.processForceReindex();
    this.daemonProcessBlocks();
    this.logger.log('Daemon process blocks initialized');
  }

  private async processForceReindex() {
    const reindexHeight = this.getReindexHeight();
    if (reindexHeight !== null) {
      await this.deleteBlocks(reindexHeight);
      this.logger.log(`Reindexing from height ${reindexHeight}`);
    }
  }

  private getReindexHeight(): number | null {
    const reindexHeight = process.env.REINDEX_BLOCK_HEIGHT;
    return reindexHeight !== undefined
        ? Math.max(parseInt(reindexHeight), this.genesisBlockHeight)
        : null;
  }

  private async deleteBlocks(height: number) {
    await this.dataSource.manager.transaction(async (manager) => {
      await Promise.all([
        manager.delete(BlockEntity, { height: MoreThanOrEqual(height) }),
        this.txService.deleteTx(manager, height),
      ]);
    });
  }

  private async daemonProcessBlocks() {
    while (true) {
      try {
        await this.processBlocks();
      } catch (e) {
        this.logger.error(`Daemon process blocks error: ${e.message}`);
        await sleep(Constants.BLOCK_PROCESSING_INTERVAL);
      }
    }
  }

  private async processBlocks() {
    const lastProcessedBlock = await this.getLastProcessedBlock();
    const nextHeight = lastProcessedBlock
        ? lastProcessedBlock.height + 1
        : this.genesisBlockHeight;

    const nextHash = await this.getBlockHash(nextHeight);
    if (!nextHash) {
      this.logger.warn(`No hash found for height ${nextHeight}, retrying in ${Constants.BLOCK_PROCESSING_INTERVAL / 1000} seconds...`);
      await sleep(Constants.BLOCK_PROCESSING_INTERVAL);
      return;
    }

    const nextHeader = await this.processReorg(nextHash);
    await this.processBlock(nextHeader);
  }

  private async processReorg(nextHash: string): Promise<BlockHeader> {
    let nextHeader: BlockHeader;
    let hash = nextHash;

    while (true) {
      nextHeader = await this.getBlockHeader(hash);

      if (nextHeader.height === this.genesisBlockHeight) break;

      const exists = await this.blockEntityRepository.exists({
        where: { hash: nextHeader.previousblockhash },
      });

      if (exists) break;

      hash = nextHeader.previousblockhash;
    }

    if (nextHeader.hash !== nextHash) {
      this.logger.log(
          `Reorg detected: common ancestor at height #${nextHeader.height - 1}, ${nextHeader.previousblockhash}`,
      );
      await this.deleteBlocks(nextHeader.height);
    }

    return nextHeader;
  }

  private async processBlock(blockHeader: BlockHeader) {
    const rawBlock = await this.getRawBlock(blockHeader.hash);
    const block = Block.fromHex(rawBlock);

    if (block.transactions.length === 0) {
      this.logger.warn(`Block #${blockHeader.height} has no transactions`);
      return;
    }

    const startTime = Date.now();

    let catTxsCount = 0;
    let catProcessingTime = 0;

    for (let i = 0; i < block.transactions.length; i++) {
      try {
        const processingTime = await this.txService.processTx(block.transactions[i], i, blockHeader);

        if (processingTime !== undefined) {
          catTxsCount += 1;
          catProcessingTime += processingTime;
        }
      } catch (e) {
        this.logger.error(`Error processing transaction ${i} in block #${blockHeader.height}: ${e.message}`);
      }
    }

    await this.blockEntityRepository.save({
      ...blockHeader,
      previousHash: blockHeader.previousblockhash,
    });

    this.logBlockProcessing(blockHeader, block.transactions.length, startTime, catTxsCount, catProcessingTime);
  }

  private async logBlockProcessing(
      blockHeader: BlockHeader,
      txCount: number,
      startTime: number,
      catTxsCount: number,
      catProcessingTime: number
  ) {
    const latestBlockHeight = (await this.getBlockchainInfo())?.headers;
    const percentage = latestBlockHeight
        ? `[${((blockHeader.height / latestBlockHeight) * 100).toFixed(2)}%]`.padStart(10, ' ')
        : '';

    const processingTime = Math.ceil(Date.now() - startTime);
    const tps = Math.ceil((txCount / processingTime) * 1000);
    const catTps = Math.ceil((catTxsCount / catProcessingTime) * 1000);

    this.logger.log(
        `${percentage} ==== Processed block #${blockHeader.height} ${blockHeader.hash}, ` +
        `${txCount} txs, ${processingTime} ms, ${tps} tps, ` +
        `${catTxsCount} cat txs, ${catProcessingTime} ms, ${catTps} tps`,
    );
  }

  private async getBlockHash(height: number): Promise<string | undefined> {
    try {
      const resp = await this.rpcService.getBlockHash(height);
      return resp?.data?.result;
    } catch (error) {
      this.logger.error(`Error getting block hash for height ${height}: ${error.message}`);
      return undefined;
    }
  }

  private async getBlockHeader(blockHash: string): Promise<BlockHeader> {
    try {
      const resp = await this.rpcService.getBlockHeader(blockHash);
      return resp.data.result;
    } catch (error) {
      this.logger.error(`Error getting block header for hash ${blockHash}: ${error.message}`);
      throw error;
    }
  }

  private async getRawBlock(blockHash: string): Promise<string> {
    try {
      const resp = await this.rpcService.getBlock(blockHash);
      return resp.data.result;
    } catch (error) {
      this.logger.error(`Error getting raw block for hash ${blockHash}: ${error.message}`);
      throw error;
    }
  }

  public async getLastProcessedBlock(): Promise<BlockEntity | null> {
    try {
      const blocks = await this.blockEntityRepository.find({
        take: 1,
        order: { height: 'DESC' },
      });
      return blocks[0] || null;
    } catch (error) {
      this.logger.error(`Error getting last processed block: ${error.message}`);
      throw error;
    }
  }

  public async getLastProcessedBlockHeight(): Promise<number | null> {
    const block = await this.getLastProcessedBlock();
    return block?.height || null;
  }

  public async getBlockchainInfo() {
    this.logger.log('Fetching blockchain info...');
    try {
      const resp = await this.rpcService.getBlockchainInfo();
      this.logger.log(`Blockchain info fetched: ${JSON.stringify(resp?.data?.result)}`);
      return resp?.data?.result;
    } catch (error) {
      this.logger.error(`Error fetching blockchain info: ${error.message}`);
      try {
        this.logger.log('Retrying to fetch blockchain info...');
        const resp = await this.rpcService.getBlockchainInfo();
        this.logger.log(`Blockchain info fetched on retry: ${JSON.stringify(resp?.data?.result)}`);
        return resp?.data?.result;
      } catch (retryError) {
        this.logger.error(`Error fetching blockchain info on retry: ${retryError.message}`);
        throw retryError;
      }
    }
  }

}
