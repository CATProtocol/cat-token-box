import {
  Cat20TokenInfo,
  OpenMinterCat20Meta,
  CAT20OpenMinterState,
  CAT20Utxo,
  CAT20OpenMinterUtxo,
  addrToP2trLockingScript,
  p2trLockingScriptToAddr,
  CAT20OpenMinterCovenant,
} from '@cat-protocol/cat-sdk-v2';
import { isCAT20V2OpenMinter } from './minterFinder';
import { getTokenContractP2TR } from './utils';
import { findTokenInfoById, scaleMetadata } from 'src/token';
import { logerror } from './log';
import { ConfigService, SpendService } from 'src/providers';
import fetch from 'node-fetch-cjs';
import { ChainProvider, uint8ArrayToHex } from '@scrypt-inc/scrypt-ts-btc';
import * as bitcoinjs from '@scrypt-inc/bitcoinjs-lib';
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
        // return {
        //   utxos: [
        //     {
        //       utxo: {
        //         txId: 'f545a2220ec29c28f6c5f5d22775daff75fa91c5e5c2d4147b3c9a7ea4f64cc7',
        //         outputIndex: 1,
        //         script:
        //           '51201b7140556377727404b41aa92c7c83baebcec553a62977ea43fdb04cca104fc1',
        //         satoshis: 331,
        //       },
        //       txoStateHashes: [
        //         '5ed5b8a0fae49a06b5e50e622612c4c0e876ab54',
        //         'a90ba4e2d7aec935e2f091069e636b3e24de4dca',
        //         'fbeb78dd6a67074eab6682a4e129f1c414adfe67',
        //         '',
        //         '',
        //       ],
        //       txHashPreimage:
        //         '020000000296f1791c7adc8b418ebac6f1263ae576f538818ae3c22dc1167057ca9fe8a4e60100000000ffffffff96f1791c7adc8b418ebac6f1263ae576f538818ae3c22dc1167057ca9fe8a4e60400000000fdffffff0500000000000000001a6a1863617401e1e04aff2fc71b218d8da0ae22d94a9760ea53d54b010000000000002251201b7140556377727404b41aa92c7c83baebcec553a62977ea43fdb04cca104fc14b010000000000002251201b7140556377727404b41aa92c7c83baebcec553a62977ea43fdb04cca104fc14a01000000000000225120277428e2c9bd8bf8ebc4a52ec7bf0080be3538165e7bb44b323c5e2ae7090c67001af50b0000000022512095dd2038a862d8f9327939bc43d182185e4e678a34136276ca52bf4b5355fa3c00000000',
        //     },
        //   ],
        // };
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
