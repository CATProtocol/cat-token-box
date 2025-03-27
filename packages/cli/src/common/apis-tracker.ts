import {
  Cat20TokenInfo,
  OpenMinterCat20Meta,
  CAT20OpenMinterState,
  CAT20Utxo,
  CAT20OpenMinterUtxo,
  addrToP2trLockingScript,
  p2trLockingScriptToAddr,
  CAT20OpenMinterCovenant,
  Cat721NftInfo,
  Cat721Metadata,
  CAT721OpenMinterUtxo,
  CAT721OpenMinterMerkleTreeData,
  CAT721OpenMinterState,
  CAT721OpenMinterCovenant,
  CAT721Utxo,
} from '@cat-protocol/cat-sdk-v2';
import { isCAT20V2OpenMinter } from './minterFinder';
import { getCat20ContractP2TR, getCat721ContractP2TR } from './utils';
import { findTokenInfoById, scaleMetadata } from 'src/token';
import { logerror } from './log';
import { ConfigService, SpendService } from 'src/providers';
import fetch from 'node-fetch-cjs';
import { ChainProvider } from '@scrypt-inc/scrypt-ts-btc';

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
            getCat20ContractP2TR(minterP2TR),
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
): Promise<CAT20OpenMinterState | null> {
  const tokenP2TR = addrToP2trLockingScript(tokenInfo.tokenAddr);
  const scaledMetadata = scaleMetadata(tokenInfo.metadata);
  if (txId === tokenInfo.revealTxid) {
    const maxCount = scaledMetadata.max / scaledMetadata.limit;
    const premineCount = scaledMetadata.premine / scaledMetadata.limit;
    const remainingSupplyCount = maxCount - premineCount;
    return {
      hasMintedBefore: false,
      remainingCount: BigInt(remainingSupplyCount),
      tokenScript: tokenP2TR,
    };
  }

  const txhex = await chainProvider.getRawTransaction(txId);
  const utxo = CAT20OpenMinterCovenant.utxoFromMintTx(txhex, vout);
  return utxo.state;
};

export const getTokenMinter = async function (
  config: ConfigService,
  spendService: SpendService,
  chainProvider: ChainProvider,
  tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta>,
  offset: number = 0,
): Promise<CAT20OpenMinterUtxo | null> {
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
      if (isCAT20V2OpenMinter(tokenInfo.metadata.minterMd5)) {
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

              const minterUtxo: CAT20OpenMinterUtxo = {
                ...utxoData.utxo,
                txoStateHashes: utxoData.txoStateHashes as any,
                txHashPreimage: utxoData.txHashPreimage,
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
): Promise<Array<CAT20Utxo>> {
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
      let cat20Utxos: Array<CAT20Utxo> = utxos.map((utxoData) => {
        if (typeof utxoData.utxo.satoshis === 'string') {
          utxoData.utxo.satoshis = parseInt(utxoData.utxo.satoshis);
        }

        const cat20Utxo: CAT20Utxo = {
          ...utxoData.utxo,
          txoStateHashes: utxoData.txoStateHashes,
          txHashPreimage: utxoData.txHashPreimage,
          state: {
            ownerAddr: utxoData.state.address,
            amount: BigInt(utxoData.state.amount),
          },
        };

        return cat20Utxo;
      });

      cat20Utxos = cat20Utxos.filter((tokenContract) => {
        return spendService.isUnspent(tokenContract);
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

export const getCollectionInfo = async function (
  config: ConfigService,
  id: string,
): Promise<Cat721NftInfo<Cat721Metadata> | null> {
  const url = `${config.getTracker()}/api/collections/${id}`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        if (res.data === null) {
          return null;
        }
        const collection = res.data;
        if (collection.metadata.max) {
          // convert string to  bigint
          collection.metadata.max = BigInt(collection.metadata.max);
        }

        if (collection.metadata.premine) {
          // convert string to  bigint
          collection.metadata.premine = BigInt(collection.metadata.premine);
        }

        if (!collection.collectionAddr) {
          const minterP2TR = addrToP2trLockingScript(collection.minterAddr);
          const network = config.getNetwork();
          collection.collectionAddr = p2trLockingScriptToAddr(
            getCat721ContractP2TR(minterP2TR),
            network,
          );
        }
        return collection;
      } else {
        throw new Error(res.msg);
      }
    })
    .catch((e) => {
      logerror(`get collection info failed!`, e);
      return null;
    });
};

const fetchNftOpenMinterState = async function (
  chainProvider: ChainProvider,
  collectionInfo: Cat721NftInfo<Cat721Metadata>,
  txId: string,
  vout: number,
  collectionMerkleTree: CAT721OpenMinterMerkleTreeData,
): Promise<CAT721OpenMinterState | null> {
  const nftP2TR = addrToP2trLockingScript(collectionInfo.collectionAddr);
  if (txId === collectionInfo.revealTxid) {
    return {
      merkleRoot: collectionMerkleTree.merkleRoot,
      nextLocalId: 0n,
      nftScript: nftP2TR,
    };
  }

  const txhex = await chainProvider.getRawTransaction(txId);
  const utxo = CAT721OpenMinterCovenant.utxoFromMintTx(
    txhex,
    vout,
    collectionInfo.metadata.max,
    collectionMerkleTree,
  );
  return utxo.state;
};

export const getNFTMinter = async function (
  config: ConfigService,
  spendSerivce: SpendService,
  chainProvider: ChainProvider,
  collectionInfo: Cat721NftInfo<Cat721Metadata>,
  collectionMerkleTree: CAT721OpenMinterMerkleTreeData,
): Promise<CAT721OpenMinterUtxo | null> {
  const url = `${config.getTracker()}/api/minters/${collectionInfo.collectionId}/utxos?limit=100&offset=${0}`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxos: utxos }) => {
      return Promise.all(
        utxos
          .filter((utxoData) => spendSerivce.isUnspent(utxoData.utxo))
          .map(async (utxoData) => {
            const data = await fetchNftOpenMinterState(
              chainProvider,
              collectionInfo,
              utxoData.utxo.txId,
              utxoData.utxo.outputIndex,
              collectionMerkleTree,
            );

            if (data === null) {
              throw new Error(
                `fetch open minter state failed, minter: ${collectionInfo.minterAddr}, txId: ${utxoData.utxo.txId}`,
              );
            }

            if (typeof utxoData.utxo.satoshis === 'string') {
              utxoData.utxo.satoshis = parseInt(utxoData.utxo.satoshis);
            }

            const minterUtxo: CAT721OpenMinterUtxo = {
              ...utxoData.utxo,
              txoStateHashes: utxoData.txoStateHashes as any,
              txHashPreimage: utxoData.txHashPreimage,
              state: data,
            };
            return minterUtxo;
          }),
      );
    })
    .then((minters) => {
      return minters[0] || null;
    })
    .catch((e) => {
      logerror(`fetch minters failed, minter: ${collectionInfo.minterAddr}`, e);
      return null;
    });
};

export const getNft = async function (
  config: ConfigService,
  collection: Cat721NftInfo<Cat721Metadata>,
  localId: bigint,
): Promise<CAT721Utxo | null> {
  const url = `${config.getTracker()}/api/collections/${collection.collectionId}/localId/${localId}/utxo`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxo: data }) => {
      if (!data) {
        return null;
      }

      if (typeof data.utxo.satoshis === 'string') {
        data.utxo.satoshis = parseInt(data.utxo.satoshis);
      }

      const r: CAT721Utxo = {
        ...data.utxo,
        txoStateHashes: data.txoStateHashes,
        txHashPreimage: data.txHashPreimage,
        state: {
          ownerAddr: data.state.address,
          localId: BigInt(data.state.localId),
        },
      };

      return r;
    })
    .catch((e) => {
      logerror(`fetch CAT721Utxo failed:`, e);
      return null;
    });
};
