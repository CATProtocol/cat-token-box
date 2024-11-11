import {
  ProtocolState,
  ProtocolStateList,
} from "@cat-protocol/cat-smartcontracts";
import { NFTContract } from "./contact";
import { CollectionInfo } from "./metadata";
import { logerror } from "./log";
import { ConfigService } from "./configService";
import fetch from "cross-fetch";
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
    collectionId: string;
    confirmed: string;
  }>;
};

export const getCollectionInfo = async function (
  config: ConfigService,
  id: string
): Promise<CollectionInfo | null> {
  const url = `${config.getTracker()}/api/collections/${id}`;
  console.log(url);
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        const token = res.data;
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

export const getCollections = async function (
  config: ConfigService,
  metadata: CollectionInfo,
  ownerAddress: string
): Promise<{
  trackerBlockHeight: number;
  contracts: Array<NFTContract>;
} | null> {
  const url = `${config.getTracker()}/api/collections/${metadata.collectionId}/addresses/${ownerAddress}/utxos`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        console.log("data", res.data);
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ utxos, trackerBlockHeight }) => {
      let contracts: Array<NFTContract> = utxos.map((c: any) => {
        const protocolState = ProtocolState.fromStateHashList(
          c.txoStateHashes as ProtocolStateList
        );

        if (typeof c.utxo.satoshis === "string") {
          c.utxo.satoshis = parseInt(c.utxo.satoshis);
        }

        const r: NFTContract = {
          utxo: c.utxo,
          state: {
            protocolState,
            data: {
              ownerAddr: c.state.address,
              localId: BigInt(c.state.localId),
            },
          },
        };
        return r;
      });
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

export const getBalance = async function (
  config: ConfigService,
  metadata: CollectionInfo,
  ownerAddress: string
): Promise<{
  collectionId: string;
  symbol: string;
  confirmed: bigint;
}> {
  const url = `${config.getTracker()}/api/collections/${metadata.collectionId}/addresses/${ownerAddress}/utxoCount`;
  return fetch(url, config.withProxy())
    .then((res) => res.json())
    .then((res: any) => {
      if (res.code === 0) {
        return res.data;
      } else {
        throw new Error(res.msg);
      }
    })
    .then(({ confirmed, collectionId }) => {
      return {
        collectionId: collectionId,
        symbol: metadata.metadata.symbol,
        confirmed: BigInt(confirmed),
      };
    })
    .catch((e) => {
      logerror(`fetch balance failed`, e);
      return {
        collectionId: metadata.collectionId,
        symbol: metadata.metadata.symbol,
        confirmed: BigInt(0),
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
