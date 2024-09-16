import {
  OpenMinterState,
  ProtocolState,
  ProtocolStateList,
} from '@cat-protocol/cat-smartcontracts';
import { OpenMinterContract, TokenContract } from './contact';
import { OpenMinterTokenInfo, TokenMetadata } from './metadata';
import { isOpenMinter } from './minterFinder';
import { getRawTransaction } from './apis';
import {
  getTokenContractP2TR,
  p2tr2Address,
  script2P2TR,
  toP2tr,
} from './utils';
import { byteString2Int } from 'scrypt-ts';
import { findTokenMetadataById, scaleConfig } from 'src/token';
import { logerror } from './log';
import { ConfigService, SpendService, WalletService } from 'src/providers';
import { btc } from './btc';
import fetch from 'node-fetch-cjs';
import { MinterType } from './minter';
import { OpenMinterV2State } from '@cat-protocol/cat-smartcontracts';

export type ContractJSON = {
  utxo: {
    txId: string;
    outputIndex: number;
    script: string;
    satoshis: number;
  };
  txoStateHashes: Array<string>;
  state: any;
};

export type BalanceJSON = {
  blockHeight: number;
  balances: Array<{
    tokenId: string;
    confirmed: string;
  }>;
};

export const getTokenMetadata = async function (
  config: ConfigService,
  id: string,
): Promise<TokenMetadata | null> {
  const url = `${config.getTracker()}/api/tokens/${id}`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        if (res.data === null) {
          return null;
        }
        const token = res.data;
        if (token.info.max) {
          // convert string to  bigint
          token.info.max = BigInt(token.info.max);
          token.info.premine = BigInt(token.info.premine);
          token.info.limit = BigInt(token.info.limit);
        }

        if (!token.tokenAddr) {
          const minterP2TR = toP2tr(token.minterAddr);
          const network = config.getNetwork();
          token.tokenAddr = p2tr2Address(
            getTokenContractP2TR(minterP2TR).p2tr,
            network,
          );
        }
        return token;
      } else {
        throw new Error(res.msg);
      }
    })
    .catch((e) => {
      logerror(`get token metadata failed!`, e);
      return null;
    });
};

export const getTokenMinterCount = async function (
  config: ConfigService,
  id: string,
): Promise<number> {
  const url = `${config.getTracker()}/api/minters/${id}/utxoCount`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ count }) => {
      return count;
    })
    .catch((e) => {
      logerror(`fetch token minter count failed!`, e);
      return 0;
    });
};

const fetchOpenMinterState = async function (
  config: ConfigService,
  wallet: WalletService,
  metadata: TokenMetadata,
  txId: string,
  vout: number,
): Promise<OpenMinterState | OpenMinterV2State | null> {
  const minterP2TR = toP2tr(metadata.minterAddr);
  const tokenP2TR = toP2tr(metadata.tokenAddr);
  const info = metadata.info as OpenMinterTokenInfo;
  const scaledInfo = scaleConfig(info);
  if (txId === metadata.revealTxid) {
    if (metadata.info.minterMd5 == MinterType.OPEN_MINTER_V2) {
      return {
        isPremined: false,
        remainingSupplyCount:
          (scaledInfo.max - scaledInfo.premine) / scaledInfo.limit,
        tokenScript: tokenP2TR,
      };
    }
    return {
      isPremined: false,
      remainingSupply: scaledInfo.max - scaledInfo.premine,
      tokenScript: tokenP2TR,
    };
  }

  const txhex = await getRawTransaction(config, wallet, txId);
  if (txhex instanceof Error) {
    logerror(`get raw transaction ${txId} failed!`, txhex);
    return null;
  }

  const tx = new btc.Transaction(txhex);

  const REMAININGSUPPLY_WITNESS_INDEX = 16;

  for (let i = 0; i < tx.inputs.length; i++) {
    const witnesses = tx.inputs[i].getWitnesses();

    if (witnesses.length > 2) {
      const lockingScriptBuffer = witnesses[witnesses.length - 2];
      const { p2tr } = script2P2TR(lockingScriptBuffer);
      if (p2tr === minterP2TR) {
        if (metadata.info.minterMd5 == MinterType.OPEN_MINTER_V2) {
          const preState: OpenMinterV2State = {
            tokenScript:
              witnesses[REMAININGSUPPLY_WITNESS_INDEX - 2].toString('hex'),
            isPremined: true,
            remainingSupplyCount: byteString2Int(
              witnesses[6 + vout].toString('hex'),
            ),
          };

          return preState;
        }
        const preState: OpenMinterState = {
          tokenScript:
            witnesses[REMAININGSUPPLY_WITNESS_INDEX - 2].toString('hex'),
          isPremined: true,
          remainingSupply: byteString2Int(witnesses[6 + vout].toString('hex')),
        };

        return preState;
      }
    }
  }

  return null;
};

export const getTokenMinter = async function (
  config: ConfigService,
  wallet: WalletService,
  metadata: TokenMetadata,
  offset: number = 0,
): Promise<OpenMinterContract | null> {
  const url = `${config.getTracker()}/api/minters/${metadata.tokenId}/utxos?limit=1&offset=${offset}`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxos: contracts }) => {
      if (isOpenMinter(metadata.info.minterMd5)) {
        return Promise.all(
          contracts.map(async (c) => {
            const protocolState = ProtocolState.fromStateHashList(
              c.txoStateHashes as ProtocolStateList,
            );

            const data = await fetchOpenMinterState(
              config,
              wallet,
              metadata,
              c.utxo.txId,
              c.utxo.outputIndex,
            );

            if (data === null) {
              throw new Error(
                `fetch open minter state failed, minter: ${metadata.minterAddr}, txId: ${c.utxo.txId}`,
              );
            }

            if (typeof c.utxo.satoshis === 'string') {
              c.utxo.satoshis = parseInt(c.utxo.satoshis);
            }

            return {
              utxo: c.utxo,
              state: {
                protocolState,
                data,
              },
            } as OpenMinterContract;
          }),
        );
      } else {
        throw new Error('Unkown minter!');
      }
    })
    .then((minters) => {
      return minters[0] || null;
    })
    .catch((e) => {
      logerror(`fetch minters failed, minter: ${metadata.minterAddr}`, e);
      return null;
    });
};

export const getTokens = async function (
  config: ConfigService,
  spendService: SpendService,
  metadata: TokenMetadata,
  ownerAddress: string,
): Promise<{
  trackerBlockHeight: number;
  contracts: Array<TokenContract>;
} | null> {
  const url = `${config.getTracker()}/api/tokens/${metadata.tokenId}/addresses/${ownerAddress}/utxos`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxos, trackerBlockHeight }) => {
      let contracts: Array<TokenContract> = utxos.map((c) => {
        const protocolState = ProtocolState.fromStateHashList(
          c.txoStateHashes as ProtocolStateList,
        );

        if (typeof c.utxo.satoshis === 'string') {
          c.utxo.satoshis = parseInt(c.utxo.satoshis);
        }

        const r: TokenContract = {
          utxo: c.utxo,
          state: {
            protocolState,
            data: {
              ownerAddr: c.state.address,
              amount: BigInt(c.state.amount),
            },
          },
        };

        return r;
      });

      contracts = contracts.filter((tokenContract) => {
        return spendService.isUnspent(tokenContract.utxo);
      });

      if (trackerBlockHeight - spendService.blockHeight() > 100) {
        spendService.reset();
      }
      spendService.updateBlockHeight(trackerBlockHeight);

      return {
        contracts,
        trackerBlockHeight: trackerBlockHeight as number,
      };
    })
    .catch((e) => {
      logerror(`fetch tokens failed:`, e);
      return null;
    });
};

export const getAllBalance = async function (
  config: ConfigService,
  ownerAddress: string,
): Promise<
  Array<{
    tokenId: string;
    symbol: string;
    confirmed: bigint;
  }>
> {
  const url = `${config.getTracker()}/api/addresses/${ownerAddress}/balances`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ balances }) => {
      return Promise.all(
        balances.map(async (b) => {
          const metadata = await findTokenMetadataById(config, b.tokenId);
          return {
            tokenId: b.tokenId,
            symbol: metadata.info.symbol,
            confirmed: BigInt(b.confirmed),
          };
        }),
      );
    })
    .catch((e) => {
      logerror(`fetch all balance failed!`, e);
      return [];
    });
};

export const getBalance = async function (
  config: ConfigService,
  metadata: TokenMetadata,
  ownerAddress: string,
): Promise<{
  tokenId: string;
  symbol: string;
  confirmed: bigint;
}> {
  const url = `${config.getTracker()}/api/tokens/${metadata.tokenId}/addresses/${ownerAddress}/balance`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ confirmed, tokenId }) => {
      return {
        tokenId: tokenId,
        symbol: metadata.info.symbol,
        confirmed: BigInt(confirmed),
      };
    })
    .catch((e) => {
      logerror(`fetch balance failed`, e);
      return {
        tokenId: metadata.tokenId,
        symbol: metadata.info.symbol,
        confirmed: 0n,
      };
    });
};

export const getTrackerStatus = async function (config: ConfigService): Promise<
  | {
      trackerBlockHeight: number;
      nodeBlockHeight: number;
      latestBlockHeight: number;
    }
  | Error
> {
  const url = `${config.getTracker()}/api`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .catch((e) => {
      logerror(`fetch tracker status failed`, e);
      return e;
    });
};

// Tracker block height lags behind node
// Insufficient token balance
