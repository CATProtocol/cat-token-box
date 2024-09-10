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

@Injectable()
export class TxService {
  private readonly logger = new Logger(TxService.name);

  private readonly GUARD_PUBKEY: string;
  private readonly TRANSFER_GUARD_SCRIPT_HASH: string;

  private static readonly taprootPaymentCache = new LRUCache<
    string,
    { pubkey: Buffer; redeemScript: Buffer }
  >({
    max: 10000,
    ttlAutopurge: true,
  });

  constructor(
    private dataSource: DataSource,
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
    try {
      if (tx.isCoinbase()) {
        return;
      }
      // update spent status of txOut records no matter whether tx is CAT-related
      await this.updateSpent(tx, txIndex, blockHeader);
      // filter CAT tx
      if (!this.isCatTx(tx)) {
        return;
      }
    } catch (e) {
      this.logger.error(`process tx ${tx.getId()} error, ${e.message}`);
    }
    const before = Date.now();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const payIns = tx.ins.map((input) => this.parseTaprootInput(input));
      const payOuts = tx.outs.map((output) => this.parseTaprootOutput(output));
      // filter tx with Guard outputs
      if (this.searchGuardOutputs(payOuts)) {
        this.logger.log(`[OK] guard builder ${tx.getId()}`);
        return;
      }
      await this.saveTx(queryRunner.manager, tx, payOuts, txIndex, blockHeader);
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
            tx,
            guardInput,
          );
        }
        this.logger.log(`[OK] transfer tx ${tx.getId()}`);
      }
      // update state hashes
      const rootHash = this.parseStateRootHash(tx);
      await this.updateStateHashes(
        queryRunner.manager,
        [rootHash, ...stateHashes],
        tx.getId(),
      );
      await queryRunner.commitTransaction();
      return Math.ceil(Date.now() - before);
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
   * Update spent status of txOut records
   * @param tx transaction to save
   * @param txIndex index of this transaction in the block
   * @param blockHeader header of the block that contains this transaction
   */
  private async updateSpent(
    tx: Transaction,
    txIndex: number,
    blockHeader: BlockHeader,
  ) {
    await this.dataSource.manager.transaction(async (manager) => {
      let affected = false;
      for (let i = 0; i < tx.ins.length; i++) {
        const prevTxid = Buffer.from(tx.ins[i].hash).reverse().toString('hex');
        const prevOutputIndex = tx.ins[i].index;
        const updateResult = await manager.update(
          TxOutEntity,
          {
            txid: prevTxid,
            outputIndex: prevOutputIndex,
          },
          {
            spendTxid: tx.getId(),
            spendInputIndex: i,
          },
        );
        affected = affected || (updateResult.affected || 0) > 0;
      }
      if (affected) {
        // save tx in case of reorg
        await manager.save(TxEntity, {
          txid: tx.getId(),
          blockHeight: blockHeader.height,
          txIndex,
        });
      }
    });
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

  /**
   * Save tx and related txOut records
   * @param tx transaction to save
   * @param txIndex index of this transaction in the block
   * @param blockHeader header of the block that contains this transaction
   */
  private async saveTx(
    manager: EntityManager,
    tx: Transaction,
    payOuts: TaprootPayment[],
    txIndex: number,
    blockHeader: BlockHeader,
  ) {
    // save tx
    await manager.save(TxEntity, {
      txid: tx.getId(),
      blockHeight: blockHeader.height,
      txIndex,
    });
    // save tx outputs
    for (let i = 0; i < tx.outs.length; i++) {
      await manager.save(TxOutEntity, {
        txid: tx.getId(),
        outputIndex: i,
        blockHeight: blockHeader.height,
        satoshis: BigInt(tx.outs[i].value),
        lockingScript: tx.outs[i].script.toString('hex'),
        xOnlyPubKey: payOuts[i]?.pubkey?.toString('hex'),
      });
    }
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
        const tokenInfo = await this.tokenInfoEntityRepository.findOne({
          where: { minterPubKey: xOnlyPubKey },
        });
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

  private async processRevealTx(
    manager: EntityManager,
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
    await manager.save(TokenInfoEntity, {
      tokenId,
      revealTxid: tx.getId(),
      revealHeight: blockHeader.height,
      genesisTxid,
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      rawInfo: tokenInfo,
      minterPubKey,
    });
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
    const { tokenPubKey, outputIndex } = this.searchMintTxTokenOutput(
      payOuts,
      tokenInfo,
    );
    await Promise.all([
      // update token owner and amount
      manager.update(
        TxOutEntity,
        {
          txid: tx.getId(),
          outputIndex,
        },
        {
          ownerPubKeyHash,
          tokenAmount,
        },
      ),
      // update token info
      manager.update(
        TokenInfoEntity,
        {
          tokenId: tokenInfo.tokenId,
        },
        {
          tokenPubKey,
        },
      ),
      // update token mint record
      manager.save(TokenMintEntity, {
        txid: tx.getId(),
        tokenPubKey,
        ownerPubKeyHash,
        tokenAmount,
        blockHeight: blockHeader.height,
      }),
    ]);
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
    tx: Transaction,
    guardInput: TaprootPayment,
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
      // update token owner and amount
      await Promise.all([
        tokenOutputs.map((tokenOutput) => {
          return manager.update(
            TxOutEntity,
            {
              txid: tx.getId(),
              outputIndex: tokenOutput.outputIndex,
            },
            {
              ownerPubKeyHash: tokenOutput.ownerPubKeyHash,
              tokenAmount: tokenOutput.tokenAmount,
            },
          );
        }),
      ]);
    }
    return stateHashes;
  }

  /**
   * Parse token outputs from guard input of a transfer tx
   */
  private parseTokenOutputs(guardInput: TaprootPayment): {
    ownerPubKeyHash: string;
    tokenAmount: bigint;
    outputIndex: number;
  }[] {
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
    const tokenOutputs = [];
    for (let i = 0; i < Constants.CONTRACT_OUTPUT_MAX_COUNT; i++) {
      if (masks[i].toString('hex') !== '') {
        const ownerPubKeyHash = ownerPubKeyHashes[i].toString('hex');
        const tokenAmount = BigInt(
          tokenAmounts[i].readIntLE(0, tokenAmounts[i].length),
        );
        tokenOutputs.push({
          ownerPubKeyHash,
          tokenAmount,
          outputIndex: i + 1,
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

  /**
   * Update state hashes of tx outputs in database
   */
  private async updateStateHashes(
    manager: EntityManager,
    stateHashes: Buffer[],
    txid: string,
  ) {
    await Promise.all([
      stateHashes.map((stateHash, i) => {
        return manager.update(
          TxOutEntity,
          {
            txid: txid,
            outputIndex: i,
          },
          {
            stateHash: stateHash.toString('hex'),
          },
        );
      }),
    ]);
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
    const txs = await this.txEntityRepository.find({
      select: ['txid'],
      where: { blockHeight: MoreThanOrEqual(height) },
    });
    await Promise.all([
      txs.map((tx) => {
        return manager.delete(TokenInfoEntity, { genesisTxid: tx.txid });
      }),
      txs.map((tx) => {
        return manager.update(
          TxOutEntity,
          { spendTxid: tx.txid },
          { spendTxid: null, spendInputIndex: null },
        );
      }),
      manager.delete(TokenInfoEntity, {
        revealHeight: MoreThanOrEqual(height),
      }),
      manager.delete(TokenMintEntity, {
        blockHeight: MoreThanOrEqual(height),
      }),
      manager.delete(TxEntity, { blockHeight: MoreThanOrEqual(height) }),
      manager.delete(TxOutEntity, { blockHeight: MoreThanOrEqual(height) }),
    ]);
  }
}
