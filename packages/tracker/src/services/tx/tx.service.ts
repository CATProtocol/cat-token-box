import { Injectable, Logger } from '@nestjs/common';
import { TxEntity } from '../../entities/tx.entity';
import {
  DataSource,
  EntityManager,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  payments,
  Transaction,
  TxInput,
  TxOutput,
  crypto,
} from 'bitcoinjs-lib';
import { TxOutEntity } from '../../entities/txOut.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Constants } from '../../common/constants';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { CatTxError } from '../../common/exceptions';
import { parseTokenInfo, TaprootPayment } from '../../common/utils';
import { BlockHeader, TokenInfo } from '../../common/types';
import { TokenMintEntity } from '../../entities/tokenMint.entity';
import { getGuardContractInfo } from '@cat-protocol/cat-smartcontracts';
import { LRUCache } from 'lru-cache';
import { CommonService } from '../common/common.service';
import { TxOutArchiveEntity } from 'src/entities/txOutArchive.entity';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TxService {
  private readonly logger = new Logger(TxService.name);

  private readonly GUARD_PUBKEY: string;
  private readonly TRANSFER_GUARD_SCRIPT_HASH: string;

  private static readonly taprootPaymentCache = new LRUCache<
    string,
    { pubkey: Buffer; redeemScript: Buffer }
  >({
    max: Constants.CACHE_MAX_SIZE,
  });

  private static readonly tokenInfoCache = new LRUCache<
    string,
    TokenInfoEntity
  >({
    max: Constants.CACHE_MAX_SIZE,
  });

  constructor(
    private dataSource: DataSource,
    private commonService: CommonService,
    @InjectRepository(TokenInfoEntity)
    private tokenInfoEntityRepository: Repository<TokenInfoEntity>,
    @InjectRepository(TxEntity)
    private txEntityRepository: Repository<TxEntity>,
  ) {
    const guardContractInfo = getGuardContractInfo();
    this.GUARD_PUBKEY = guardContractInfo.tpubkey;
    this.TRANSFER_GUARD_SCRIPT_HASH =
      guardContractInfo.contractTaprootMap.transfer.contractScriptHash;
    this.logger.log(`guard xOnlyPubKey = ${this.GUARD_PUBKEY}`);
    this.logger.log(
      `guard transferScriptHash = ${this.TRANSFER_GUARD_SCRIPT_HASH}`,
    );
  }

  /**
   * Process a transaction
   * @param tx transaction to save
   * @param txIndex index of this transaction in the block
   * @param blockHeader header of the block that contains this transaction
   * @returns processing time in milliseconds if successfully processing a CAT-related tx, otherwise undefined
   */
  async processTx(tx: Transaction, txIndex: number, blockHeader: BlockHeader) {
    if (tx.isCoinbase()) {
      return;
    }
    // filter CAT tx
    if (!this.isCatTx(tx)) {
      return;
    }
    const payOuts = tx.outs.map((output) => this.parseTaprootOutput(output));
    // filter tx with Guard outputs
    if (this.searchGuardOutputs(payOuts)) {
      this.logger.log(`[OK] guard builder ${tx.getId()}`);
      return;
    }
    const payIns = tx.ins.map((input) => this.parseTaprootInput(input));

    const startTs = Date.now();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const promises: Promise<any>[] = [];
      this.updateSpent(queryRunner.manager, promises, tx);
      let stateHashes: Buffer[];
      // search Guard inputs
      const guardInputs = this.searchGuardInputs(payIns);
      if (guardInputs.length === 0) {
        // no Guard in inputs
        // search minter in inputs
        const { minterInput, tokenInfo } = await this.searchMinterInput(payIns);
        if (!tokenInfo) {
          // no minter in inputs, this is a token reveal tx
          stateHashes = await this.processRevealTx(
            queryRunner.manager,
            promises,
            tx,
            payIns,
            payOuts,
            blockHeader,
          );
          this.logger.log(`[OK] reveal tx ${tx.getId()}`);
        } else {
          // found minter in inputs, this is a token mint tx
          stateHashes = await this.processMintTx(
            queryRunner.manager,
            promises,
            tx,
            payOuts,
            minterInput,
            tokenInfo,
            blockHeader,
          );
          this.logger.log(`[OK] mint tx ${tx.getId()}`);
        }
      } else {
        // found Guard in inputs, this is a token transfer tx
        for (const guardInput of guardInputs) {
          stateHashes = await this.processTransferTx(
            queryRunner.manager,
            promises,
            tx,
            guardInput,
            payOuts,
            blockHeader,
          );
        }
        this.logger.log(`[OK] transfer tx ${tx.getId()}`);
      }
      await Promise.all([
        ...promises,
        this.saveTx(queryRunner.manager, tx, txIndex, blockHeader, stateHashes),
      ]);
      await queryRunner.commitTransaction();
      return Math.ceil(Date.now() - startTs);
    } catch (e) {
      if (e instanceof CatTxError) {
        this.logger.log(`skip tx ${tx.getId()}, ${e.message}`);
      } else {
        this.logger.error(`process tx ${tx.getId()} error, ${e.message}`);
      }
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Check if this is a CAT tx
   */
  private isCatTx(tx: Transaction) {
    if (tx.outs.length > 0) {
      // OP_RETURN OP_PUSHBYTES_24 'cat' <1 byte version> <20 bytes root_hash>
      return tx.outs[0].script.toString('hex').startsWith('6a1863617401');
    }
    return false;
  }

  private async updateSpent(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
  ) {
    tx.ins.forEach((input, i) => {
      const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
      const prevOutputIndex = input.index;
      promises.push(
        manager.update(
          TxOutEntity,
          {
            txid: prevTxid,
            outputIndex: prevOutputIndex,
          },
          {
            spendTxid: tx.getId(),
            spendInputIndex: i,
          },
        ),
      );
    });
  }

  private async saveTx(
    manager: EntityManager,
    tx: Transaction,
    txIndex: number,
    blockHeader: BlockHeader,
    stateHashes: Buffer[],
  ) {
    const rootHash = this.parseStateRootHash(tx);
    return manager.save(TxEntity, {
      txid: tx.getId(),
      blockHeight: blockHeader.height,
      txIndex,
      stateHashes: [rootHash, ...stateHashes]
        .map((stateHash) => stateHash.toString('hex'))
        .join(';'),
    });
  }

  /**
   * Search Guard in tx outputs
   * @returns true if found Guard tx outputs, false otherwise
   */
  private searchGuardOutputs(payOuts: TaprootPayment[]): boolean {
    for (const payOut of payOuts) {
      if (this.GUARD_PUBKEY === payOut?.pubkey?.toString('hex')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Search Guard in tx inputs
   * @returns array of Guard inputs
   */
  private searchGuardInputs(payIns: TaprootPayment[]): TaprootPayment[] {
    return payIns.filter((payIn) => {
      return this.GUARD_PUBKEY === payIn?.pubkey?.toString('hex');
    });
  }

  /**
   * Search minter in tx inputs.
   * If no minter input found, returns { minterInput: null, tokenInfo: null }
   *
   * If there is more than one minter input, throw an error.
   */
  private async searchMinterInput(payIns: TaprootPayment[]): Promise<{
    minterInput: TaprootPayment | null;
    tokenInfo: TokenInfoEntity | null;
  }> {
    let minter = {
      minterInput: null,
      tokenInfo: null,
    };
    for (const payIn of payIns) {
      const xOnlyPubKey = payIn?.pubkey?.toString('hex');
      if (xOnlyPubKey) {
        const tokenInfo = await this.getTokenInfo(xOnlyPubKey);
        if (tokenInfo) {
          if (minter.tokenInfo) {
            throw new CatTxError(
              'invalid mint tx, multiple minter inputs found',
            );
          }
          minter = {
            minterInput: payIn,
            tokenInfo,
          };
        }
      }
    }
    return minter;
  }

  private async getTokenInfo(minterPubKey: string) {
    let tokenInfo = TxService.tokenInfoCache.get(minterPubKey);
    if (!tokenInfo) {
      tokenInfo = await this.tokenInfoEntityRepository.findOne({
        where: { minterPubKey },
      });
      if (tokenInfo && tokenInfo.tokenPubKey) {
        const lastProcessedHeight =
          await this.commonService.getLastProcessedBlockHeight();
        if (
          lastProcessedHeight !== null &&
          lastProcessedHeight - tokenInfo.revealHeight >=
            Constants.TOKEN_INFO_CACHE_BLOCKS_THRESHOLD
        ) {
          TxService.tokenInfoCache.set(minterPubKey, tokenInfo);
        }
      }
    }
    return tokenInfo;
  }

  private async processRevealTx(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
    payIns: TaprootPayment[],
    payOuts: TaprootPayment[],
    blockHeader: BlockHeader,
  ) {
    // commit input
    const { inputIndex: commitInputIndex, tokenInfo } =
      this.searchRevealTxCommitInput(payIns);
    const commitInput = payIns[commitInputIndex];
    const genesisTxid = Buffer.from(tx.ins[commitInputIndex].hash)
      .reverse()
      .toString('hex');
    const tokenId = `${genesisTxid}_${tx.ins[commitInputIndex].index}`;
    // state hashes
    const stateHashes = commitInput.witness.slice(
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET,
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this.validateStateHashes(stateHashes);
    // minter output
    const minterPubKey = this.searchRevealTxMinterOutputs(payOuts);
    // save token info
    promises.push(
      manager.save(TokenInfoEntity, {
        tokenId,
        revealTxid: tx.getId(),
        revealHeight: blockHeader.height,
        genesisTxid,
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        rawInfo: tokenInfo,
        minterPubKey,
      }),
    );
    // save tx outputs
    promises.push(
      manager.save(
        TxOutEntity,
        tx.outs
          .map((_, i) =>
            payOuts[i]?.pubkey
              ? this.buildBaseTxOutEntity(tx, i, blockHeader, payOuts)
              : null,
          )
          .filter((out) => out !== null),
      ),
    );
    return stateHashes;
  }

  /**
   * There is one and only one commit in the reveal tx inputs.
   * The commit input must contain a valid token info.
   * The token info must contain name, symbol, and decimals.
   *
   * If there are multiple commit inputs, throw an error.
   * If there is no commit input, throw an error.
   */
  private searchRevealTxCommitInput(payIn: TaprootPayment[]): {
    inputIndex: number;
    tokenInfo: TokenInfo;
  } {
    let commit = null;
    for (let i = 0; i < payIn.length; i++) {
      if (
        payIn[i] &&
        payIn[i].witness.length >= Constants.COMMIT_INPUT_WITNESS_MIN_SIZE
      ) {
        try {
          // parse token info from commit redeem script
          const tokenInfo = parseTokenInfo(payIn[i].redeemScript);
          if (tokenInfo) {
            // token info is valid here
            if (commit) {
              throw new CatTxError(
                'invalid reveal tx, multiple commit inputs found',
              );
            }
            commit = {
              inputIndex: i,
              tokenInfo,
            };
          }
        } catch (e) {
          this.logger.error(`search commit in reveal tx error, ${e.message}`);
        }
      }
    }
    if (!commit) {
      throw new CatTxError('invalid reveal tx, missing commit input');
    }
    return commit;
  }

  /**
   * There is one and only one type of minter in the reveal tx outputs.
   * There are no other outputs except OP_RETURN and minter.
   *
   * If there is no minter output, throw an error.
   * If the x-only pubkey of other outputs differ from the first minter, throw an error.
   *
   * @returns minter output x-only pubkey
   */
  private searchRevealTxMinterOutputs(payOuts: TaprootPayment[]): string {
    if (payOuts.length < 2) {
      throw new CatTxError('invalid reveal tx, missing minter output');
    }
    const minterPubKey = payOuts[1]?.pubkey?.toString('hex');
    if (!minterPubKey) {
      throw new CatTxError('invalid reveal tx, missing minter output');
    }
    for (let i = 2; i < payOuts.length; i++) {
      const outputPubKey = payOuts[i]?.pubkey?.toString('hex');
      if (!outputPubKey || outputPubKey !== minterPubKey) {
        throw new CatTxError('invalid reveal tx, output other than minter');
      }
    }
    return minterPubKey;
  }

  private async processMintTx(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
    payOuts: TaprootPayment[],
    minterInput: TaprootPayment,
    tokenInfo: TokenInfoEntity,
    blockHeader: BlockHeader,
  ) {
    if (minterInput.witness.length < Constants.MINTER_INPUT_WITNESS_MIN_SIZE) {
      throw new CatTxError('invalid mint tx, invalid minter witness field');
    }
    const stateHashes = minterInput.witness.slice(
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET,
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this.validateStateHashes(stateHashes);

    // ownerPubKeyHash
    if (
      minterInput.witness[Constants.MINTER_INPUT_WITNESS_ADDR_OFFSET].length !==
      Constants.PUBKEY_HASH_BYTES
    ) {
      throw new CatTxError(
        'invalid mint tx, invalid byte length of owner pubkey hash',
      );
    }
    const ownerPubKeyHash =
      minterInput.witness[Constants.MINTER_INPUT_WITNESS_ADDR_OFFSET].toString(
        'hex',
      );
    // tokenAmount
    if (
      minterInput.witness[Constants.MINTER_INPUT_WITNESS_AMOUNT_OFFSET].length >
      Constants.TOKEN_AMOUNT_MAX_BYTES
    ) {
      throw new CatTxError(
        'invalid mint tx, invalid byte length of token amount',
      );
    }
    const tokenAmount = BigInt(
      minterInput.witness[
        Constants.MINTER_INPUT_WITNESS_AMOUNT_OFFSET
      ].readIntLE(
        0,
        minterInput.witness[Constants.MINTER_INPUT_WITNESS_AMOUNT_OFFSET]
          .length,
      ),
    );
    if (tokenAmount <= 0n) {
      throw new CatTxError('invalid mint tx, token amount should be positive');
    }
    // token output
    const { tokenPubKey, outputIndex: tokenOutputIndex } =
      this.searchMintTxTokenOutput(payOuts, tokenInfo);

    // update token info when first mint
    if (tokenInfo.tokenPubKey === null) {
      promises.push(
        manager.update(
          TokenInfoEntity,
          {
            tokenId: tokenInfo.tokenId,
          },
          {
            tokenPubKey,
            firstMintHeight: blockHeader.height,
          },
        ),
      );
    }
    // save token mint
    promises.push(
      manager.save(TokenMintEntity, {
        txid: tx.getId(),
        tokenPubKey,
        ownerPubKeyHash,
        tokenAmount,
        blockHeight: blockHeader.height,
      }),
    );
    // save tx outputs
    promises.push(
      manager.save(
        TxOutEntity,
        tx.outs
          .map((_, i) => {
            if (i <= tokenOutputIndex && payOuts[i]?.pubkey) {
              const baseEntity = this.buildBaseTxOutEntity(
                tx,
                i,
                blockHeader,
                payOuts,
              );
              return i === tokenOutputIndex
                ? {
                    ...baseEntity,
                    ownerPubKeyHash,
                    tokenAmount,
                  }
                : baseEntity;
            }
            return null;
          })
          .filter((out) => out !== null),
      ),
    );
    return stateHashes;
  }

  /**
   * There is one and only one token in outputs.
   * The token output must be the first output right after minter.
   *
   * If there is no token output, throw an error.
   * If there are multiple token outputs, throw an error.
   * If the minter outputs are not consecutive, throw an error.
   * If the token output pubkey differs from what it minted before, throw an error.
   */
  private searchMintTxTokenOutput(
    payOuts: TaprootPayment[],
    tokenInfo: TokenInfoEntity,
  ) {
    let tokenOutput = {
      tokenPubKey: '',
      outputIndex: -1,
    };
    for (let i = 1; i < payOuts.length; i++) {
      const outputPubKey = payOuts[i]?.pubkey?.toString('hex');
      if (tokenOutput.tokenPubKey) {
        // token output found, this output cannot be a minter or a token output
        //
        if (!outputPubKey) {
          // good if cannot parse x-only pubkey from this output
          continue;
        }
        if (outputPubKey === tokenInfo.minterPubKey) {
          // invalid if get a minter output again after the token output was found
          throw new CatTxError(
            'invalid mint tx, minter outputs are not consecutive',
          );
        }
        if (outputPubKey === tokenOutput.tokenPubKey) {
          // invalid if get a token output again after the token output was found
          throw new CatTxError('invalid mint tx, multiple token outputs found');
        }
      } else {
        // token output not found yet, this output can only be a minter or a token output
        //
        if (!outputPubKey) {
          // invalid if cannot parse x-only pubkey from this output
          throw new CatTxError('invalid mint tx, invalid output structure');
        }
        if (outputPubKey === tokenInfo.minterPubKey) {
          // good if get a minter output
          continue;
        }
        // potential token output here
        //
        if (
          tokenInfo.tokenPubKey !== null &&
          tokenInfo.tokenPubKey !== outputPubKey
        ) {
          // invalid if get a token output that is different from the previously minted token pubkey
          throw new CatTxError(
            'invalid mint tx, invalid token output with a different pubkey',
          );
        }
        // valid token output here
        tokenOutput = {
          tokenPubKey: outputPubKey,
          outputIndex: i,
        };
      }
    }
    if (!tokenOutput.tokenPubKey) {
      throw new CatTxError('invalid mint tx, missing token output');
    }
    return tokenOutput;
  }

  private async processTransferTx(
    manager: EntityManager,
    promises: Promise<any>[],
    tx: Transaction,
    guardInput: TaprootPayment,
    payOuts: TaprootPayment[],
    blockHeader: BlockHeader,
  ) {
    if (guardInput.witness.length < Constants.GUARD_INPUT_WITNESS_MIN_SIZE) {
      throw new CatTxError('invalid transfer tx, invalid guard witness field');
    }
    const stateHashes = guardInput.witness.slice(
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET,
      Constants.CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET +
        Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this.validateStateHashes(stateHashes);

    const scriptHash = crypto
      .hash160(guardInput?.redeemScript || Buffer.alloc(0))
      .toString('hex');
    if (scriptHash === this.TRANSFER_GUARD_SCRIPT_HASH) {
      const tokenOutputs = this.parseTokenOutputs(guardInput);
      // save tx outputs
      promises.push(
        manager.save(
          TxOutEntity,
          [...tokenOutputs.keys()].map((i) => {
            return {
              ...this.buildBaseTxOutEntity(tx, i, blockHeader, payOuts),
              ownerPubKeyHash: tokenOutputs.get(i).ownerPubKeyHash,
              tokenAmount: tokenOutputs.get(i).tokenAmount,
            };
          }),
        ),
      );
    }
    return stateHashes;
  }

  /**
   * Parse token outputs from guard input of a transfer tx
   */
  private parseTokenOutputs(guardInput: TaprootPayment) {
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
      if (masks[i].toString('hex') !== '') {
        const ownerPubKeyHash = ownerPubKeyHashes[i].toString('hex');
        const tokenAmount = BigInt(
          tokenAmounts[i].readIntLE(0, tokenAmounts[i].length),
        );
        tokenOutputs.set(i + 1, {
          ownerPubKeyHash,
          tokenAmount,
        });
      }
    }
    return tokenOutputs;
  }

  /**
   * Parse state root hash from tx
   */
  private parseStateRootHash(tx: Transaction) {
    return tx.outs[0].script.subarray(
      Constants.STATE_ROOT_HASH_OFFSET,
      Constants.STATE_ROOT_HASH_OFFSET + Constants.STATE_ROOT_HASH_BYTES,
    );
  }

  private validateStateHashes(stateHashes: Buffer[]) {
    for (const stateHash of stateHashes) {
      if (
        stateHash.length !== 0 &&
        stateHash.length !== Constants.STATE_HASH_BYTES
      ) {
        throw new CatTxError('invalid state hash length');
      }
    }
  }

  /**
   * Parse taproot input from tx input, returns null if failed
   */
  private parseTaprootInput(input: TxInput): TaprootPayment | null {
    try {
      const key = crypto
        .hash160(
          Buffer.concat([
            crypto.hash160(input.witness[input.witness.length - 2]), // redeem script
            crypto.hash160(input.witness[input.witness.length - 1]), // cblock
          ]),
        )
        .toString('hex');
      let cached = TxService.taprootPaymentCache.get(key);
      if (!cached) {
        const taproot = payments.p2tr({ witness: input.witness });
        cached = {
          pubkey: taproot?.pubkey,
          redeemScript: taproot?.redeem?.output,
        };
        TxService.taprootPaymentCache.set(key, cached);
      }
      return Object.assign({}, cached, { witness: input.witness });
    } catch {
      return null;
    }
  }

  /**
   * Parse taproot output from tx output, returns null if failed
   */
  private parseTaprootOutput(output: TxOutput): TaprootPayment | null {
    try {
      if (
        output.script.length !== Constants.TAPROOT_LOCKING_SCRIPT_LENGTH ||
        !output.script.toString('hex').startsWith('5120')
      ) {
        return null;
      }
      return {
        pubkey: output.script.subarray(2, 34),
        redeemScript: null,
        witness: null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete tx in blocks with height greater than or equal to the given height
   */
  public async deleteTx(manager: EntityManager, height: number) {
    // txs to delete
    const txs = await this.txEntityRepository.find({
      select: ['txid'],
      where: { blockHeight: MoreThanOrEqual(height) },
    });
    const promises = [
      manager.delete(TokenInfoEntity, {
        revealHeight: MoreThanOrEqual(height),
      }),
      manager.update(
        TokenInfoEntity,
        { firstMintHeight: MoreThanOrEqual(height) },
        { firstMintHeight: null, tokenPubKey: null },
      ),
      manager.delete(TokenMintEntity, {
        blockHeight: MoreThanOrEqual(height),
      }),
      manager.delete(TxEntity, { blockHeight: MoreThanOrEqual(height) }),
      manager.delete(TxOutEntity, { blockHeight: MoreThanOrEqual(height) }),
      // reset spent status of tx outputs
      ...txs.map((tx) => {
        return manager.update(
          TxOutEntity,
          { spendTxid: tx.txid },
          { spendTxid: null, spendInputIndex: null },
        );
      }),
    ];
    if (txs.length > 0) {
      // Empty criteria(s) are not allowed for the delete method
      promises.push(
        manager.delete(
          TokenInfoEntity,
          txs.map((tx) => {
            return { genesisTxid: tx.txid };
          }),
        ),
      );
    }
    return Promise.all(promises);
  }

  private buildBaseTxOutEntity(
    tx: Transaction,
    outputIndex: number,
    blockHeader: BlockHeader,
    payOuts: TaprootPayment[],
  ) {
    return {
      txid: tx.getId(),
      outputIndex,
      blockHeight: blockHeader.height,
      satoshis: BigInt(tx.outs[outputIndex].value),
      lockingScript: tx.outs[outputIndex].script.toString('hex'),
      xOnlyPubKey: payOuts[outputIndex].pubkey.toString('hex'),
    };
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  private async archiveTxOuts() {
    const lastProcessedHeight =
      await this.commonService.getLastProcessedBlockHeight();
    if (lastProcessedHeight === null) {
      return;
    }
    const txOuts = await this.dataSource.manager
      .createQueryBuilder('tx_out', 'txOut')
      .innerJoin('tx', 'tx', 'txOut.spend_txid = tx.txid')
      .where('txOut.spend_txid IS NOT NULL')
      .andWhere('tx.block_height < :blockHeight', {
        blockHeight: lastProcessedHeight - 3 * 2880, // blocks before three days ago
      })
      .orderBy('tx.block_height', 'ASC')
      .addOrderBy('tx.tx_index', 'ASC')
      .limit(1000) // archive no more than 1000 records once a time
      .getMany();
    if (txOuts.length === 0) {
      return;
    }
    await this.dataSource.transaction(async (manager) => {
      await Promise.all([
        manager.save(TxOutArchiveEntity, txOuts),
        manager.delete(
          TxOutEntity,
          txOuts.map((txOut) => {
            return { txid: txOut.txid, outputIndex: txOut.outputIndex };
          }),
        ),
      ]);
    });
    this.logger.log(`archived ${txOuts.length} tx outputs`);
  }
}
