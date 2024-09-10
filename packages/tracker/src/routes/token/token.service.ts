import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TokenInfoEntity } from '../../entities/tokenInfo.entity';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import {
  addressToXOnlyPubKey,
  ownerAddressToPubKeyHash,
  xOnlyPubKeyToAddress,
} from '../../common/utils';
import { TxOutEntity } from '../../entities/txOut.entity';
import { Constants } from '../../common/constants';
import { BlockService } from '../../services/block/block.service';

@Injectable()
export class TokenService {
  constructor(
    private readonly blockService: BlockService,
    @InjectRepository(TokenInfoEntity)
    private readonly tokenInfoRepository: Repository<TokenInfoEntity>,
    @InjectRepository(TxOutEntity)
    private readonly txOutRepository: Repository<TxOutEntity>,
  ) {}

  async getTokenInfoByTokenIdOrTokenAddress(tokenIdOrTokenAddr: string) {
    let where;
    if (tokenIdOrTokenAddr.includes('_')) {
      where = { tokenId: tokenIdOrTokenAddr };
    } else {
      const tokenPubKey = addressToXOnlyPubKey(tokenIdOrTokenAddr);
      if (!tokenPubKey) {
        return null;
      }
      where = { tokenPubKey };
    }
    const tokenInfo = await this.tokenInfoRepository.findOne({
      where,
    });
    return this.renderTokenInfo(tokenInfo);
  }

  renderTokenInfo(tokenInfo: TokenInfoEntity) {
    if (!tokenInfo) {
      return null;
    }
    const minterAddr = xOnlyPubKeyToAddress(tokenInfo.minterPubKey);
    const tokenAddr = xOnlyPubKeyToAddress(tokenInfo.tokenPubKey);
    const rendered = Object.assign(
      {},
      { minterAddr, tokenAddr, info: tokenInfo.rawInfo },
      tokenInfo,
    );
    delete rendered.rawInfo;
    delete rendered.createdAt;
    delete rendered.updatedAt;
    return rendered;
  }

  async getTokenUtxosByOwnerAddress(
    tokenIdOrTokenAddr: string,
    ownerAddr: string,
    offset: number,
    limit: number,
  ) {
    const lastProcessedHeight =
      await this.blockService.getLastProcessedBlockHeight();
    const tokenInfo =
      await this.getTokenInfoByTokenIdOrTokenAddress(tokenIdOrTokenAddr);
    let utxos = [];
    if (tokenInfo) {
      utxos = await this.queryTokenUtxosByOwnerAddress(
        lastProcessedHeight,
        ownerAddr,
        tokenInfo,
        offset || Constants.QUERY_PAGING_DEFAULT_OFFSET,
        Math.min(
          limit || Constants.QUERY_PAGING_DEFAULT_LIMIT,
          Constants.QUERY_PAGING_MAX_LIMIT,
        ),
      );
    }
    return {
      utxos: await this.renderUtxos(utxos),
      trackerBlockHeight: lastProcessedHeight,
    };
  }

  async getTokenBalanceByOwnerAddress(
    tokenIdOrTokenAddr: string,
    ownerAddr: string,
  ) {
    const lastProcessedHeight =
      await this.blockService.getLastProcessedBlockHeight();
    const tokenInfo =
      await this.getTokenInfoByTokenIdOrTokenAddress(tokenIdOrTokenAddr);
    let utxos = [];
    if (tokenInfo) {
      utxos = await this.queryTokenUtxosByOwnerAddress(
        lastProcessedHeight,
        ownerAddr,
        tokenInfo,
      );
    }
    let confirmed = '0';
    if (tokenInfo?.tokenPubKey) {
      const tokenBalances = this.groupTokenBalances(utxos);
      confirmed = tokenBalances[tokenInfo.tokenPubKey]?.toString() || '0';
    }
    return {
      tokenId: tokenInfo?.tokenId || null,
      confirmed,
      trackerBlockHeight: lastProcessedHeight,
    };
  }

  async queryTokenUtxosByOwnerAddress(
    lastProcessedHeight: number,
    ownerAddr: string,
    tokenInfo: TokenInfoEntity = null,
    offset: number = null,
    limit: number = null,
  ) {
    const ownerPubKeyHash = ownerAddressToPubKeyHash(ownerAddr);
    if (
      lastProcessedHeight === null ||
      (tokenInfo && !tokenInfo.tokenPubKey) ||
      !ownerPubKeyHash
    ) {
      return [];
    }
    const where = {
      ownerPubKeyHash,
      spendTxid: IsNull(),
      blockHeight: LessThanOrEqual(lastProcessedHeight),
    };
    if (tokenInfo) {
      Object.assign(where, { xOnlyPubKey: tokenInfo.tokenPubKey });
    }
    return this.txOutRepository.find({
      where,
      order: { tokenAmount: 'DESC' },
      skip: offset,
      take: limit,
    });
  }

  async queryStateHashes(txid: string) {
    const outputs = await this.txOutRepository.find({
      select: ['stateHash'],
      where: { txid },
      order: { outputIndex: 'ASC' },
    });
    const stateHashes = outputs.map((output) => output.stateHash);
    for (
      let i = stateHashes.length;
      i < Constants.CONTRACT_OUTPUT_MAX_COUNT + 1;
      i++
    ) {
      stateHashes.push('');
    }
    return stateHashes;
  }

  async renderUtxos(utxos: TxOutEntity[]) {
    const renderedUtxos = [];
    for (const utxo of utxos) {
      const stateHashes = await this.queryStateHashes(utxo.txid);
      const renderedUtxo = {
        utxo: {
          txId: utxo.txid,
          outputIndex: utxo.outputIndex,
          script: utxo.lockingScript,
          satoshis: utxo.satoshis,
        },
        txoStateHashes: stateHashes.slice(1),
      };
      if (utxo.ownerPubKeyHash !== null && utxo.tokenAmount !== null) {
        Object.assign(renderedUtxo, {
          state: {
            address: utxo.ownerPubKeyHash,
            amount: utxo.tokenAmount,
          },
        });
      }
      renderedUtxos.push(renderedUtxo);
    }
    return renderedUtxos;
  }

  /**
   * @param utxos utxos with the same owner address
   * @returns token balances grouped by xOnlyPubKey
   */
  groupTokenBalances(utxos: TxOutEntity[]) {
    const balances = {};
    for (const utxo of utxos) {
      balances[utxo.xOnlyPubKey] =
        (balances[utxo.xOnlyPubKey] || 0n) + BigInt(utxo.tokenAmount);
    }
    return balances;
  }

  async getTokenTxHistoryByOwnerAddress(
    tokenIdOrTokenAddr: string,
    ownerAddr: string,
    offset: number,
    limit: number,
  ) {
    const lastProcessedHeight =
      await this.blockService.getLastProcessedBlockHeight();
    const tokenInfo =
      await this.getTokenInfoByTokenIdOrTokenAddress(tokenIdOrTokenAddr);
    const ownerPubKeyHash = ownerAddressToPubKeyHash(ownerAddr);
    if (
      lastProcessedHeight === null ||
      !tokenInfo ||
      !tokenInfo.tokenPubKey ||
      !ownerPubKeyHash
    ) {
      return { history: [], blockHeight: lastProcessedHeight };
    }
    const sql = `select distinct tx.txid, tx.block_height
      from tx_out
              left join tx on tx_out.txid = tx.txid or tx_out.spend_txid = tx.txid
      where tx_out.owner_pkh = $1
        and tx_out.xonly_pubkey = $2
        and tx.block_height <= $3
      order by tx.block_height desc
      limit $4 offset $5;`;
    const history = await this.txOutRepository.query(sql, [
      ownerPubKeyHash,
      tokenInfo.tokenPubKey,
      lastProcessedHeight,
      Math.min(
        limit || Constants.QUERY_PAGING_DEFAULT_LIMIT,
        Constants.QUERY_PAGING_MAX_LIMIT,
      ),
      offset || Constants.QUERY_PAGING_DEFAULT_OFFSET,
    ]);
    return {
      history: history.map((e) => e.txid),
      trackerBlockHeight: lastProcessedHeight,
    };
  }
}
