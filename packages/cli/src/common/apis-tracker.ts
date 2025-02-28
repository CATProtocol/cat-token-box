import {
  Cat20TokenInfo,
  OpenMinterCat20Meta,
  OpenMinterState,
  ChainProvider,
  Cat20Utxo,
  Cat20MinterUtxo,
  addrToP2trLockingScript,
  p2trLockingScriptToAddr,
  btc,
  scriptToP2tr,
} from '@cat-protocol/cat-sdk-v2';
import { isOpenMinter } from './minterFinder';
import { getTokenContractP2TR } from './utils';
import { byteString2Int } from 'scrypt-ts';
import { findTokenInfoById, scaleMetadata } from 'src/token';
import { logerror } from './log';
import { ConfigService, SpendService } from 'src/providers';
import fetch from 'node-fetch-cjs';

export const getTokenInfo = async function (
  config: ConfigService,
  id: string,
): Promise<Cat20TokenInfo<OpenMinterCat20Meta> | null> {
  const url = `${config.getTracker()}/api/tokens/${id}`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        if (res.data === null) {
          return null;
        }
        const token = res.data;

        const { info, metadata, tokenAddr, ...rest } = token;

        let metadataTmp: any = {};
        if (info) {
          Object.assign(metadataTmp, info);
        } else {
          metadataTmp = metadata;
        }

        if (typeof metadataTmp.max === 'string') {
          // convert string to  bigint
          metadataTmp.max = BigInt(metadataTmp.max);
          metadataTmp.premine = BigInt(metadataTmp.premine);
          metadataTmp.limit = BigInt(metadataTmp.limit);
        }
        let tokenAddrTmp: string = tokenAddr;
        if (!tokenAddrTmp) {
          const minterP2TR = addrToP2trLockingScript(token.minterAddr);
          const network = config.getNetwork();
          tokenAddrTmp = p2trLockingScriptToAddr(
            getTokenContractP2TR(minterP2TR),
            network,
          );
        }
        return {
          tokenAddr: tokenAddrTmp,
          metadata: metadataTmp,
          ...rest,
        };
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

const fetchCat20MinterState = async function (
  chainProvider: ChainProvider,
  tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta>,
  txId: string,
  vout: number,
): Promise<OpenMinterState | null> {
  const minterP2TR = addrToP2trLockingScript(tokenInfo.minterAddr);
  const tokenP2TR = addrToP2trLockingScript(tokenInfo.tokenAddr);
  const scaledMetadata = scaleMetadata(tokenInfo.metadata);
  if (txId === tokenInfo.revealTxid) {
    return {
      hasMintedBefore: false,
      remainingCount: BigInt(scaledMetadata.max - scaledMetadata.premine),
      tokenScript: tokenP2TR,
    };
  }

  const txhex = await chainProvider.getRawTransaction(txId);

  const tx = new btc.Transaction(txhex);

  const REMAININGSUPPLY_WITNESS_INDEX = 16;

  for (let i = 0; i < tx.inputs.length; i++) {
    const witnesses = tx.inputs[i].getWitnesses();

    if (witnesses.length > 2) {
      const lockingScriptBuffer = witnesses[witnesses.length - 2];
      const { p2trLockingScript: p2tr } = scriptToP2tr(lockingScriptBuffer);
      if (p2tr === minterP2TR) {
        const preState: OpenMinterState = {
          tokenScript:
            witnesses[REMAININGSUPPLY_WITNESS_INDEX - 2].toString('hex'),
          hasMintedBefore: true,
          remainingCount: byteString2Int(witnesses[6 + vout].toString('hex')),
        };
        return preState;
      }
    }
  }

  return null;
};

export const getTokenMinter = async function (
  config: ConfigService,
  spendService: SpendService,
  chainProvider: ChainProvider,
  tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta>,
  offset: number = 0,
): Promise<Cat20MinterUtxo | null> {
  const url = `${config.getTracker()}/api/minters/${tokenInfo.tokenId}/utxos?limit=1&offset=${offset}`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxos }) => {
      if (isOpenMinter(tokenInfo.metadata.minterMd5)) {
        return Promise.all(
          utxos
            .filter((utxoData) => {
              return spendService.isUnspent(utxoData.utxo);
            })
            .map(async (utxoData) => {
              const data = await fetchCat20MinterState(
                chainProvider,
                tokenInfo,
                utxoData.utxo.txId,
                utxoData.utxo.outputIndex,
              );

              if (data === null) {
                throw new Error(
                  `fetch open minter state failed, minter: ${tokenInfo.minterAddr}, txId: ${utxoData.utxo.txId}`,
                );
              }

              if (typeof utxoData.utxo.satoshis === 'string') {
                utxoData.utxo.satoshis = parseInt(utxoData.utxo.satoshis);
              }

              const minterUtxo: Cat20MinterUtxo = {
                utxo: utxoData.utxo,
                txoStateHashes: utxoData.txoStateHashes,
                state: data,
              };
              return minterUtxo;
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
      logerror(`fetch minters failed, minter: ${tokenInfo.minterAddr}`, e);
      return null;
    });
};

export const getTokens = async function (
  config: ConfigService,
  spendService: SpendService,
  tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta>,
  ownerAddress: string,
): Promise<Array<Cat20Utxo>> {
  const url = `${config.getTracker()}/api/tokens/${tokenInfo.tokenId}/addresses/${ownerAddress}/utxos`;
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
      let cat20Utxos: Array<Cat20Utxo> = utxos.map((utxoData) => {
        if (typeof utxoData.utxo.satoshis === 'string') {
          utxoData.utxo.satoshis = parseInt(utxoData.utxo.satoshis);
        }

        const cat20Utxo: Cat20Utxo = {
          utxo: utxoData.utxo,
          txoStateHashes: utxoData.txoStateHashes,
          state: {
            ownerAddr: utxoData.state.address,
            amount: BigInt(utxoData.state.amount),
          },
        };

        return cat20Utxo;
      });

      cat20Utxos = cat20Utxos.filter((tokenContract) => {
        return spendService.isUnspent(tokenContract.utxo);
      });

      if (trackerBlockHeight - spendService.blockHeight() > 100) {
        spendService.reset();
      }
      spendService.updateBlockHeight(trackerBlockHeight);

      return cat20Utxos;
    })
    .catch((e) => {
      logerror(`fetch cat20Utxo failed:`, e);
      return [];
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
          const tokenInfo = await findTokenInfoById(config, b.tokenId);
          return {
            tokenId: b.tokenId,
            symbol: tokenInfo.metadata.symbol,
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
  info: Cat20TokenInfo<OpenMinterCat20Meta>,
  ownerAddress: string,
): Promise<{
  tokenId: string;
  symbol: string;
  confirmed: bigint;
}> {
  const url = `${config.getTracker()}/api/tokens/${info.tokenId}/addresses/${ownerAddress}/balance`;
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
        symbol: info.metadata.symbol,
        confirmed: BigInt(confirmed),
      };
    })
    .catch((e) => {
      logerror(`fetch balance failed`, e);
      return {
        tokenId: info.tokenId,
        symbol: info.metadata.symbol,
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
