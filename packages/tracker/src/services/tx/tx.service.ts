import { Injectable, Logger } from '@nestjs/common';
import { TxEntity } from '../../entities/tx.entity';
import { DataSource, EntityManager, MoreThanOrEqual, Repository } from 'typeorm';
import { payments, Transaction, TxInput, crypto } from '@scrypt-inc/bitcoinjs-lib';
import { TxOutEntity } from '../../entities/txOut.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Constants } from '../../common/constants';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { NftInfoEntity } from '../../entities/nftInfo.entity';
import { CatTxError, TransferTxError } from '../../common/exceptions';
import { bin2num, parseTokenInfoEnvelope } from '../../common/utils';
import { BlockHeader, EnvelopeMarker, TaprootPayment, TokenInfoEnvelope } from '../../common/types';
import { TokenMintEntity } from '../../entities/tokenMint.entity';
import { LRUCache } from 'lru-cache';
import { CommonService } from '../common/common.service';
import { TxOutArchiveEntity } from 'src/entities/txOutArchive.entity';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class TxService {
  private readonly logger = new Logger(TxService.name);

  private static readonly taprootPaymentCache = new LRUCache<string, { pubkey: Buffer; redeemScript: Buffer }>({
    max: Constants.CACHE_MAX_SIZE,
  });

  private static readonly tokenInfoCache = new LRUCache<string, TokenInfoEntity>({
    max: Constants.CACHE_MAX_SIZE,
  });

  private dataSource: DataSource;

  constructor(
    private commonService: CommonService,
    @InjectRepository(TokenInfoEntity)
    private tokenInfoEntityRepository: Repository<TokenInfoEntity>,
    @InjectRepository(TxEntity)
    private txEntityRepository: Repository<TxEntity>,
    @InjectRepository(TxOutEntity)
    private txOutEntityRepository: Repository<TxOutEntity>,
    @InjectRepository(NftInfoEntity)
    private nftInfoEntityRepository: Repository<NftInfoEntity>,
    @InjectRepository(TokenMintEntity)
    private tokenMintEntityRepository: Repository<TokenMintEntity>,
  ) {
    this.dataSource = this.txEntityRepository.manager.connection;
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
    const payOuts = tx.outs.map((output) => this.commonService.parseTaprootOutput(output));
    // filter tx with Guard outputs
    if (this.commonService.searchGuardOutputs(payOuts)) {
      this.logger.log(`[OK] guard builder ${tx.getId()}`);
      return;
    }
    const payIns = tx.ins.map((input) => this.parseTaprootInput(input));

    const startTs = Date.now();
    try {
      this.updateSpent(tx);

      // search Guard inputs
      const guardInputs = this.commonService.searchGuardInputs(payIns);
      if (guardInputs.length > 0) {
        // found Guard in inputs, this is a token transfer tx
        for (const guardInput of guardInputs) {
          await this.processTransferTx(tx, guardInput, payOuts, txIndex, blockHeader);
        }
        this.logger.log(`[OK] transfer tx ${tx.getId()}`);
      }

      // search minter in inputs
      const { minterInput, tokenInfo } = await this.searchMinterInput(payIns);
      if (tokenInfo) {
        // found minter in inputs, this is a token mint tx
        await this.processMintTx(tx, payIns, payOuts, minterInput, tokenInfo, txIndex, blockHeader);
        this.logger.log(`[OK] mint tx ${tx.getId()}`);
      } else if (guardInputs.length === 0) {
        // no minter and Guard in inputs, this is a token reveal tx
        await this.processRevealTx(tx, payIns, payOuts, txIndex, blockHeader);
        this.logger.log(`[OK] reveal tx ${tx.getId()}`);
      }

      return Math.ceil(Date.now() - startTs);
    } catch (e) {
      if (e instanceof TransferTxError) {
        this.logger.error(`[502750] invalid transfer tx ${tx.getId()}, ${e.message}`);
      } else {
        if (e instanceof CatTxError) {
          this.logger.log(`skip tx ${tx.getId()}, ${e.message}`);
        } else {
          this.logger.error(`process tx ${tx.getId()} error, ${e.message} ${e.stack}`);
        }
      }
    }
  }

  /**
   * Check if this is a CAT tx
   */
  private isCatTx(tx: Transaction) {
    if (tx.outs.length > 0) {
      // OP_RETURN OP_PUSHBYTES_24 'cat' <1 byte version> <20 bytes root_hash>
      return Buffer.from(tx.outs[0].script).toString('hex').startsWith('6a1863617401');
    }
    return false;
  }

  private async updateSpent(tx: Transaction) {
    await Promise.all(
      tx.ins.map((input, i) => {
        const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
        const prevOutputIndex = input.index;
        return this.txOutEntityRepository.update(
          {
            txid: prevTxid,
            outputIndex: prevOutputIndex,
          },
          {
            spendTxid: tx.getId(),
            spendInputIndex: i,
          },
        );
      }),
    );
  }

  private async saveTx(tx: Transaction, txIndex: number, blockHeader: BlockHeader, stateHashes: Buffer[]) {
    const rootHash = this.parseStateRootHash(tx);
    return this.txEntityRepository.save({
      txid: tx.getId(),
      blockHeight: blockHeader.height,
      txIndex,
      stateHashes: [rootHash, ...stateHashes].map((stateHash) => stateHash.toString('hex')).join(';'),
      txHashPreimage: Buffer.from(tx.toBuffer(undefined, 0, false)).toString('hex'),
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
            throw new CatTxError('invalid mint tx, multiple minter inputs found');
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
        select: [
          'tokenId',
          'revealTxid',
          'revealHeight',
          'genesisTxid',
          'name',
          'symbol',
          'decimals',
          'minterPubKey',
          'tokenPubKey',
        ],
        where: { minterPubKey },
      });
      if (tokenInfo && tokenInfo.tokenPubKey) {
        const lastProcessedHeight = await this.commonService.getLastProcessedBlockHeight();
        if (
          lastProcessedHeight !== null &&
          lastProcessedHeight - tokenInfo.revealHeight >= Constants.CACHE_AFTER_N_BLOCKS
        ) {
          TxService.tokenInfoCache.set(minterPubKey, tokenInfo);
        }
      }
    }
    return tokenInfo;
  }

  private async processRevealTx(
    tx: Transaction,
    payIns: TaprootPayment[],
    payOuts: TaprootPayment[],
    txIndex: number,
    blockHeader: BlockHeader,
  ) {
    // commit input
    const { inputIndex: commitInputIndex, envelope } = this.searchRevealTxCommitInput(payIns);
    const commitInput = payIns[commitInputIndex];
    const genesisTxid = Buffer.from(tx.ins[commitInputIndex].hash).reverse().toString('hex');
    const tokenId = `${genesisTxid}_${tx.ins[commitInputIndex].index}`;
    const {
      marker,
      data: { metadata, content },
    } = envelope;
    // state hashes
    const stateHashes = commitInput.witness.slice(
      Constants.COMMIT_INPUT_WITNESS_STATE_HASHES_OFFSET,
      Constants.COMMIT_INPUT_WITNESS_STATE_HASHES_OFFSET + Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this.validateStateHashes(stateHashes);

    const promises: Promise<any>[] = [];
    // minter output
    const minterPubKey = this.searchRevealTxMinterOutputs(payOuts);
    // save token info
    promises.push(
      this.tokenInfoEntityRepository.save({
        tokenId,
        revealTxid: tx.getId(),
        revealHeight: blockHeader.height,
        genesisTxid,
        name: metadata['name'],
        symbol: metadata['symbol'],
        decimals: marker === EnvelopeMarker.Token ? metadata['decimals'] : -1,
        rawInfo: metadata,
        contentType: content?.type,
        contentEncoding: content?.encoding,
        contentRaw: content?.raw,
        minterPubKey,
      }),
    );
    // save tx outputs
    promises.push(
      this.txOutEntityRepository.save(
        tx.outs
          .map((_, i) => (payOuts[i]?.pubkey ? this.buildBaseTxOutEntity(tx, i, blockHeader, payOuts) : null))
          .filter((out) => out !== null),
      ),
    );
    await Promise.all([...promises, this.saveTx(tx, txIndex, blockHeader, stateHashes)]);
  }

  /**
   * There is one and only one commit in the reveal tx inputs.
   * The commit input must contain a valid token info.
   * The token info must contain name, symbol, and decimals.
   *
   * If there are multiple commit inputs, throw an error.
   * If there is no commit input, throw an error.
   */
  private searchRevealTxCommitInput(payIns: TaprootPayment[]): {
    inputIndex: number;
    envelope: TokenInfoEnvelope;
  } {
    let commit = null;
    for (let i = 0; i < payIns.length; i++) {
      if (payIns[i] && payIns[i].witness.length >= Constants.COMMIT_INPUT_WITNESS_MIN_SIZE) {
        try {
          // parse token info from commit redeem script
          const envelope = parseTokenInfoEnvelope(payIns[i].redeemScript);
          if (envelope && (envelope.marker === EnvelopeMarker.Token || envelope.marker === EnvelopeMarker.Collection)) {
            // token info is valid here
            if (commit) {
              throw new CatTxError('invalid reveal tx, multiple commit inputs found');
            }
            commit = {
              inputIndex: i,
              envelope,
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
    tx: Transaction,
    payIns: TaprootPayment[],
    payOuts: TaprootPayment[],
    minterInput: TaprootPayment,
    tokenInfo: TokenInfoEntity,
    txIndex: number,
    blockHeader: BlockHeader,
  ) {
    if (minterInput.witness.length < Constants.MINTER_INPUT_WITNESS_MIN_SIZE) {
      throw new CatTxError('invalid mint tx, invalid minter witness field');
    }
    const stateHashes = this.parseStateHashes(minterInput.witness);
    // token output
    const { tokenPubKey, outputIndex: tokenOutputIndex } = this.searchMintTxTokenOutput(payOuts, tokenInfo);
    if (tokenOutputIndex === -1) {
      // No tokens are minted in this transaction, this would not happen before.
      // Now this may be an LP minter that does not necessarily mint LP tokens every time.
      return;
    }

    // ownerPubKeyHash
    const pkh = minterInput.witness[Constants.MINTER_INPUT_WITNESS_ADDR_OFFSET];
    if (!Constants.OWNER_ADDR_BYTES.includes(pkh.length)) {
      throw new CatTxError('invalid mint tx, invalid byte length of owner pubkey hash');
    }
    const ownerPubKeyHash = pkh.toString('hex');

    // tokenAmount
    const amount = minterInput.witness[Constants.MINTER_INPUT_WITNESS_AMOUNT_OFFSET];
    if (amount.length > Constants.TOKEN_AMOUNT_MAX_BYTES) {
      throw new CatTxError('invalid mint tx, invalid byte length of token amount');
    }
    const tokenAmount = amount.length === 0 ? 0n : BigInt(amount.readIntLE(0, amount.length));
    if (tokenAmount < 0n) {
      throw new CatTxError('invalid mint tx, token amount should be non-negative');
    }
    if (tokenAmount === 0n && tokenInfo.decimals >= 0) {
      throw new CatTxError('invalid mint tx, token amount should be positive');
    }

    const promises: Promise<any>[] = [];
    // save nft info
    if (tokenInfo.decimals < 0) {
      const commitInput = this.searchMintTxCommitInput(payIns);
      if (commitInput) {
        const { inputIndex: commitInuptIndex, envelope } = commitInput;
        const commitTxid = Buffer.from(tx.ins[commitInuptIndex].hash).reverse().toString('hex');
        const {
          data: { metadata, content },
        } = envelope;
        promises.push(
          this.nftInfoEntityRepository.save({
            collectionId: tokenInfo.tokenId,
            localId: tokenAmount,
            mintTxid: tx.getId(),
            mintHeight: blockHeader.height,
            commitTxid,
            metadata: metadata,
            contentType: content?.type,
            contentEncoding: content?.encoding,
            contentRaw: content?.raw,
          }),
        );
      }
    }
    // update token info when first mint
    if (tokenInfo.tokenPubKey === null) {
      // tokenPubKey must not be shown before
      const exists = await this.tokenInfoEntityRepository.exists({ where: { tokenPubKey } });
      if (exists) {
        throw new CatTxError('invalid mint tx, first time mint but token pubkey already exists');
      }
      promises.push(
        this.tokenInfoEntityRepository.update(
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
      this.tokenMintEntityRepository.save({
        txid: tx.getId(),
        tokenPubKey,
        ownerPubKeyHash,
        tokenAmount,
        blockHeight: blockHeader.height,
      }),
    );
    // save tx outputs
    promises.push(
      this.txOutEntityRepository.save(
        tx.outs
          .map((_, i) => {
            if (i <= tokenOutputIndex && payOuts[i]?.pubkey) {
              const baseEntity = this.buildBaseTxOutEntity(tx, i, blockHeader, payOuts);
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

    await Promise.all([...promises, this.saveTx(tx, txIndex, blockHeader, stateHashes)]);
  }

  /**
   * There is one and only one token in outputs.
   * The token output must be the first output right after minter.
   *
   * If there are multiple token outputs, throw an error.
   * If the minter outputs are not consecutive, throw an error.
   */
  private searchMintTxTokenOutput(payOuts: TaprootPayment[], tokenInfo: TokenInfoEntity) {
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
          throw new CatTxError('invalid mint tx, minter outputs are not consecutive');
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
        if (tokenInfo.tokenPubKey !== null && tokenInfo.tokenPubKey !== outputPubKey) {
          // Previously, getting a token output with a different pubkey than the previously minted token would throw an exception.
          // However, this might now be an LP token minter, which does not mint LP tokens every time.
          continue;
        }
        // valid token output here
        tokenOutput = {
          tokenPubKey: outputPubKey,
          outputIndex: i,
        };
      }
    }
    return tokenOutput;
  }

  /**
   * try to parse the nft info in mint tx inputs
   */
  private searchMintTxCommitInput(payIns: TaprootPayment[]): {
    inputIndex: number;
    envelope: TokenInfoEnvelope;
  } | null {
    for (let i = 0; i < payIns.length; i++) {
      if (payIns[i]) {
        try {
          const envelope = parseTokenInfoEnvelope(payIns[i].redeemScript);
          if (envelope && envelope.marker === EnvelopeMarker.NFT) {
            return {
              inputIndex: i,
              envelope,
            };
          }
        } catch (e) {
          this.logger.error(`search commit in mint tx error, ${e.message}`);
        }
      }
    }
    return null;
  }

  private async processTransferTx(
    tx: Transaction,
    guardInput: TaprootPayment,
    payOuts: TaprootPayment[],
    txIndex: number,
    blockHeader: BlockHeader,
  ) {
    if (guardInput.witness.length < Constants.GUARD_INPUT_WITNESS_MIN_SIZE) {
      throw new CatTxError('invalid transfer tx, invalid guard witness field');
    }
    await this.checkGuardInput(guardInput, tx);
    const stateHashes = this.parseStateHashes(guardInput.witness);

    const tokenOutputs = this.commonService.parseTransferTxTokenOutputs(guardInput);

    const promises: Promise<any>[] = [];
    if (tokenOutputs.size > 0) {
      // save tx outputs
      promises.push(
        this.txOutEntityRepository.save(
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

    await Promise.all([...promises, this.saveTx(tx, txIndex, blockHeader, stateHashes)]);
  }

  /**
   * Parse state root hash from tx
   */
  private parseStateRootHash(tx: Transaction) {
    return Buffer.from(tx.outs[0].script).subarray(
      Constants.STATE_ROOT_HASH_OFFSET,
      Constants.STATE_ROOT_HASH_OFFSET + Constants.STATE_ROOT_HASH_BYTES,
    );
  }

  private validateStateHashes(stateHashes: Buffer[]) {
    for (const stateHash of stateHashes) {
      if (stateHash.length !== 0 && stateHash.length !== Constants.STATE_HASH_BYTES) {
        throw new CatTxError('invalid state hash length');
      }
    }
  }

  private parseStateHashes(witness: Buffer[]): Buffer[] {
    const offset = witness.length + Constants.MINTER_GUARD_INPUT_WITNESS_STATE_HASHES_OFFSET;
    const stateHashes = witness.slice(offset, offset + Constants.CONTRACT_OUTPUT_MAX_COUNT);
    this.validateStateHashes(stateHashes);
    return stateHashes;
  }

  /**
   * Parse taproot input from tx input, returns null if failed
   */
  private parseTaprootInput(input: TxInput): TaprootPayment | null {
    try {
      const key = Buffer.from(
        crypto.hash160(
          Buffer.concat([
            crypto.hash160(input.witness[input.witness.length - 2]), // redeem script
            crypto.hash160(input.witness[input.witness.length - 1]), // cblock
          ]),
        ),
      ).toString('hex');
      let cached = TxService.taprootPaymentCache.get(key);
      if (!cached) {
        const taproot = payments.p2tr({ witness: input.witness });
        cached = {
          pubkey: taproot.pubkey ? Buffer.from(taproot.pubkey) : undefined,
          redeemScript: taproot?.redeem?.output ? Buffer.from(taproot.redeem.output) : undefined,
        };
        TxService.taprootPaymentCache.set(key, cached);
      }
      return Object.assign({}, cached, {
        witness: input.witness.map((w) => Buffer.from(w)),
      });
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
      manager.delete(NftInfoEntity, {
        mintHeight: MoreThanOrEqual(height),
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
        return manager.update(TxOutEntity, { spendTxid: tx.txid }, { spendTxid: null, spendInputIndex: null });
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
      lockingScript: Buffer.from(tx.outs[outputIndex].script).toString('hex'),
      xOnlyPubKey: payOuts[outputIndex].pubkey.toString('hex'),
    };
  }

  @Cron('* * * * *')
  private async archiveTxOuts() {
    const startTime = Date.now();
    const lastProcessedHeight = await this.commonService.getLastProcessedBlockHeight();
    if (lastProcessedHeight === null) {
      return;
    }
    const txOuts = await this.dataSource.manager
      .createQueryBuilder('tx_out', 'txOut')
      .innerJoin('tx', 'tx', 'txOut.spend_txid = tx.txid')
      .where('txOut.spend_txid IS NOT NULL')
      .andWhere('tx.block_height < :blockHeight', {
        blockHeight: lastProcessedHeight - 2880, // blocks before one day ago
      })
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
    this.logger.log(`archived ${txOuts.length} outs in ${Math.ceil(Date.now() - startTime)} ms`);
  }

  async checkGuardInput(guardInput: TaprootPayment, tx: Transaction) {
    this.commonService.isFungibleGuard(guardInput)
      ? await this.checkFungibleGuardInput(guardInput, tx)
      : await this.checkNonFungibleGuardInput(guardInput, tx);
  }

  async checkFungibleGuardInput(guardInput: TaprootPayment, tx: Transaction) {
    const timeBefore = Date.now();

    if (guardInput.witness.length < Constants.FT_GUARD_INPUT_WITNESS_MIN_SIZE) {
      throw new TransferTxError(`invalid fungible guard witness field`);
    }
    // input token info in cur guard state
    const tokenScripts = guardInput.witness.slice(
      Constants.FT_GUARD_INPUT_CUR_STATE_TOKEN_SCRIPT_OFFSET,
      Constants.FT_GUARD_INPUT_CUR_STATE_TOKEN_SCRIPT_OFFSET + Constants.GUARD_MAX_TOKEN_TYPES,
    );
    this._arrayInspect(tokenScripts, 'tokenScripts');
    const tokenAmounts = guardInput.witness.slice(
      Constants.FT_GUARD_INPUT_CUR_STATE_TOKEN_AMOUNT_OFFSET,
      Constants.FT_GUARD_INPUT_CUR_STATE_TOKEN_AMOUNT_OFFSET + Constants.GUARD_MAX_TOKEN_TYPES,
    );
    this._arrayInspect(tokenAmounts, 'tokenAmounts');
    const burnAmounts = guardInput.witness.slice(
      Constants.FT_GUARD_INPUT_CUR_STATE_BURN_AMOUNT_OFFSET,
      Constants.FT_GUARD_INPUT_CUR_STATE_BURN_AMOUNT_OFFSET + Constants.GUARD_MAX_TOKEN_TYPES,
    );
    this._arrayInspect(burnAmounts, 'burnAmounts');
    const scriptIndexes = guardInput.witness.slice(
      Constants.FT_GUARD_INPUT_CUR_STATE_SCRIPT_INDEX_OFFSET,
      Constants.FT_GUARD_INPUT_CUR_STATE_SCRIPT_INDEX_OFFSET + Constants.CONTRACT_INPUT_MAX_COUNT,
    );
    this._arrayInspect(scriptIndexes, 'scriptIndexes');
    // output token info
    const outputTokenAmounts = guardInput.witness.slice(
      Constants.GUARD_AMOUNT_OFFSET,
      Constants.GUARD_AMOUNT_OFFSET + Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this._arrayInspect(outputTokenAmounts, 'outputTokenAmounts');
    const outputScriptIndexes = guardInput.witness.slice(
      Constants.GUARD_MASK_OFFSET,
      Constants.GUARD_MASK_OFFSET + Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this._arrayInspect(outputScriptIndexes, 'outputScriptIndexes');

    const sumOutputTokenAmounts = Array(Constants.GUARD_MAX_TOKEN_TYPES).fill(0n);
    for (let i = 0; i < Constants.CONTRACT_OUTPUT_MAX_COUNT; i++) {
      const outputScriptIndex = bin2num(outputScriptIndexes[i]);
      if (outputScriptIndex !== -1) {
        sumOutputTokenAmounts[outputScriptIndex] += BigInt(bin2num(outputTokenAmounts[i]));
      }
    }
    this._arrayInspect(sumOutputTokenAmounts, 'sumOutputTokenAmounts');

    const sumTokenAmounts = Array(Constants.GUARD_MAX_TOKEN_TYPES).fill(0n);
    for (let i = 0; i < Constants.CONTRACT_INPUT_MAX_COUNT; i++) {
      const scriptIndex = bin2num(scriptIndexes[i]);
      if (scriptIndex !== -1) {
        const tokenScript = tokenScripts[scriptIndex].toString('hex');
        // this is a token input
        const input = tx.ins[i];
        const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
        const prevOutputIndex = input.index;
        const prevout = `${prevTxid}:${prevOutputIndex}`;
        const prevOutput = await this.txOutEntityRepository.findOne({
          where: {
            txid: prevTxid,
            outputIndex: prevOutputIndex,
          },
        });
        if (!prevOutput) {
          this.logger.error(`prevout ${prevout} not found`);
          throw new TransferTxError('invalid transfer tx, token input prevout is missing');
        }
        if (prevOutput.lockingScript !== tokenScript) {
          this.logger.error(
            `prevout ${prevout} token script mismatches, required ${prevOutput.lockingScript}, got ${tokenScript}`,
          );
          throw new TransferTxError('invalid transfer tx, token script in guard not equal to it in token input');
        }
        sumTokenAmounts[scriptIndex] += BigInt(prevOutput.tokenAmount);
      }
    }
    this._arrayInspect(sumTokenAmounts, 'sumTokenAmounts');

    for (let i = 0; i < Constants.GUARD_MAX_TOKEN_TYPES; i++) {
      const tokenAmount = BigInt(bin2num(tokenAmounts[i]));
      if (tokenAmount !== sumTokenAmounts[i]) {
        this.logger.error(
          `token input amounts of type ${i} in guard cur state not equal to accumulated amount of inputs, required ${sumTokenAmounts[i]}, got ${tokenAmount}`,
        );
        throw new TransferTxError(
          `invalid transfer tx, token input amounts of type ${i} in guard cur state not equal to accumulated amount of inputs`,
        );
      }
      const burnAmount = BigInt(bin2num(burnAmounts[i]));
      const outputTokenAmount = sumOutputTokenAmounts[i];
      if (tokenAmount - burnAmount !== outputTokenAmount) {
        this.logger.error(
          `token output amounts of type ${i} in guard cur state not equal to accumulated amount of outputs, required ${outputTokenAmount}, got ${tokenAmount - burnAmount[i]}`,
        );
        throw new TransferTxError(
          `invalid transfer tx, token output amounts of type ${i} in guard cur state not equal to accumulated amount of outputs`,
        );
      }
    }

    this.logger.debug(`checkFungibleGuardInput time: ${Date.now() - timeBefore} ms`);
  }

  async checkNonFungibleGuardInput(guardInput: TaprootPayment, tx: Transaction) {
    const timeBefore = Date.now();

    if (guardInput.witness.length < Constants.NFT_GUARD_INPUT_WITNESS_MIN_SIZE) {
      throw new TransferTxError(`invalid non-fungible guard witness field`);
    }
    // input nft info in cur guard state
    const nftScripts = guardInput.witness.slice(
      Constants.NFT_GUARD_INPUT_CUR_STATE_NFT_SCRIPT_OFFSET,
      Constants.NFT_GUARD_INPUT_CUR_STATE_NFT_SCRIPT_OFFSET + Constants.GUARD_MAX_TOKEN_TYPES,
    );
    this._arrayInspect(nftScripts, 'nftScripts');
    const burnMasks = guardInput.witness.slice(
      Constants.NFT_GUARD_INPUT_CUR_STATE_BURN_MASK_OFFSET,
      Constants.NFT_GUARD_INPUT_CUR_STATE_BURN_MASK_OFFSET + Constants.CONTRACT_INPUT_MAX_COUNT,
    );
    this._arrayInspect(burnMasks, 'burnMasks');
    const scriptIndexes = guardInput.witness.slice(
      Constants.NFT_GUARD_INPUT_CUR_STATE_SCRIPT_INDEX_OFFSET,
      Constants.NFT_GUARD_INPUT_CUR_STATE_SCRIPT_INDEX_OFFSET + Constants.CONTRACT_INPUT_MAX_COUNT,
    );
    this._arrayInspect(scriptIndexes, 'scriptIndexes');
    // output nft info
    const outputLocalIds = guardInput.witness.slice(
      Constants.GUARD_AMOUNT_OFFSET,
      Constants.GUARD_AMOUNT_OFFSET + Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this._arrayInspect(outputLocalIds, 'outputLocalIds');
    const outputScriptIndexes = guardInput.witness.slice(
      Constants.GUARD_MASK_OFFSET,
      Constants.GUARD_MASK_OFFSET + Constants.CONTRACT_OUTPUT_MAX_COUNT,
    );
    this._arrayInspect(outputScriptIndexes, 'outputScriptIndexes');

    const nextNfts = Array(Constants.CONTRACT_OUTPUT_MAX_COUNT).fill({
      scriptIndex: -1,
      localId: -1n,
    });
    let nextNftCount = 0;
    for (let i = 0; i < Constants.CONTRACT_INPUT_MAX_COUNT; i++) {
      const scriptIndex = bin2num(scriptIndexes[i]);
      if (scriptIndex !== -1) {
        const nftScript = nftScripts[scriptIndex].toString('hex');
        const burnMask = bin2num(burnMasks[i]);
        // this is an nft output
        const input = tx.ins[i];
        const prevTxid = Buffer.from(input.hash).reverse().toString('hex');
        const prevOutputIndex = input.index;
        const prevout = `${prevTxid}:${prevOutputIndex}`;
        const prevOutput = await this.txOutEntityRepository.findOne({
          where: {
            txid: prevTxid,
            outputIndex: prevOutputIndex,
          },
        });
        if (!prevOutput) {
          this.logger.error(`prevout ${prevout} not found`);
          throw new TransferTxError('invalid transfer tx, nft input prevout is missing');
        }
        if (prevOutput.lockingScript !== nftScript) {
          this.logger.error(
            `prevout ${prevout} nft script mismatches, required ${prevOutput.lockingScript}, got ${nftScript}`,
          );
          throw new TransferTxError('invalid transfer tx, nft script in guard not equal to it in nft input');
        }
        if (!burnMask) {
          // this nft is not burned
          nextNfts[nextNftCount++] = {
            scriptIndex,
            localId: BigInt(prevOutput.tokenAmount),
          };
        }
      }
    }
    this.logger.debug(`nextNftCount: ${nextNftCount}`);
    this._arrayInspect(nextNfts, 'nextNfts');

    let outputNftCount = 0;
    for (let i = 0; i < Constants.CONTRACT_OUTPUT_MAX_COUNT; i++) {
      const outputScriptIndex = bin2num(outputScriptIndexes[i]);
      if (outputScriptIndex !== -1) {
        const nextNft = nextNfts[outputNftCount];
        const outputLocalId = BigInt(bin2num(outputLocalIds[outputNftCount]));
        if (nextNft.scriptIndex !== outputScriptIndex || nextNft.localId !== outputLocalId) {
          this.logger.error(
            `invalid nft at output ${i}, required ${nextNft.scriptIndex}/${nextNft.localId}, got ${outputScriptIndex}/${outputLocalId}`,
          );
          throw new TransferTxError(`invalid transfer tx, nft at output #${i} mismatches with input`);
        }
        outputNftCount++;
      }
    }

    this.logger.debug(`checkNonFungibleGuardInput time: ${Date.now() - timeBefore} ms`);
  }

  _arrayInspect(fields: any[], name: string) {
    const formatted = fields.map((field) =>
      Buffer.isBuffer(field)
        ? field.toString('hex')
        : typeof field === 'object'
          ? JSON.stringify(field, (_, value) => (typeof value === 'bigint' ? value.toString() : value))
          : field.toString(),
    );
    this.logger.log(`${name} [${formatted}]`);
  }
}
