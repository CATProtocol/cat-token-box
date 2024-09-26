import {
  ProtocolState,
  ProtocolStateList,
} from '@cat-protocol/cat-smartcontracts';
import { TokenContract } from './contact';
import { TokenMetadata } from './metadata';
import {
  getTokenContractP2TR,
  p2tr2Address,
  toP2tr,
} from './utils'
import { logerror } from './log';
import { ConfigService } from './configService';
import fetch from 'cross-fetch';
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


export const getTokens = async function (
  config: ConfigService,
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
      let contracts: Array<TokenContract> = utxos.map((c: any) => {
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
