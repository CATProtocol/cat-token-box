import { UTXO } from 'scrypt-ts';
import fetch from 'node-fetch-cjs';

import {
  rpc_broadcast,
  rpc_getconfirmations,
  rpc_getfeeRate,
  rpc_getrawtransaction,
  rpc_listunspent,
} from './apis-rpc';
import { logerror, logwarn } from './log';
import { btc } from './btc';
import { ConfigService, WalletService } from 'src/providers';

export const getFeeRate = async function (
  config: ConfigService,
  wallet: WalletService,
): Promise<number> {
  if (config.useRpc()) {
    const feeRate = await rpc_getfeeRate(config, wallet.getWalletName());
    if (feeRate instanceof Error) {
      return 2;
    }
    return feeRate;
  }

  const url = `${config.getMempoolApiHost()}/api/v1/fees/recommended`;
  const feeRate: any = await fetch(url, config.withProxy())
    .then((res) => {
      if (res.status === 200) {
        return res.json();
      }
      return {};
    })
    .catch((e) => {
      console.error(`fetch feeRate failed:`, e);
      return {};
    });

  if (!feeRate) {
    return 2;
  }

  return Math.max(2, feeRate['fastestFee'] || 1);
};

export const getFractalUtxos = async function (
  config: ConfigService,
  address: btc.Address,
): Promise<UTXO[]> {
  const script = new btc.Script(address).toHex();

  const url = `${config.getOpenApiHost()}/v1/indexer/address/${address}/utxo-data?cursor=0&size=16`;
  const utxos: Array<any> = await fetch(
    url,
    config.withProxy({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.getApiKey()}`,
      },
    }),
  )
    .then(async (res) => {
      const contentType = res.headers.get('content-type');
      if (contentType.includes('json')) {
        return res.json();
      } else {
        throw new Error(
          `invalid http content type : ${contentType}, status: ${res.status}`,
        );
      }
    })
    .then((res: any) => {
      if (res.code === 0) {
        const { data } = res;
        return data.utxo.map((utxo) => {
          return {
            txId: utxo.txid,
            outputIndex: utxo.vout,
            script: utxo.scriptPk || script,
            satoshis: utxo.satoshi,
          };
        });
      } else {
        logerror(`fetch utxos failed:`, new Error(res.msg));
      }
      return [];
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .catch((e) => {
      logerror(`fetch utxos failed:`, e);
      return [];
    });
  return utxos.sort((a, b) => a.satoshi - b.satoshi);
};

export const getUtxos = async function (
  config: ConfigService,
  wallet: WalletService,
  address: btc.Address,
): Promise<UTXO[]> {
  if (config.useRpc()) {
    const utxos = await rpc_listunspent(
      config,
      wallet.getWalletName(),
      address.toString(),
    );
    if (utxos instanceof Error) {
      return [];
    }
    return utxos;
  }

  if (config.isFractalNetwork() && !config.useRpc()) {
    return getFractalUtxos(config, address);
  }

  const script = new btc.Script(address).toHex();

  const url = `${config.getMempoolApiHost()}/api/address/${address}/utxo`;
  const utxos: Array<any> = await fetch(url, config.withProxy())
    .then(async (res) => {
      const contentType = res.headers.get('content-type');
      if (contentType.includes('json')) {
        return res.json();
      } else {
        throw new Error(
          `invalid http content type : ${contentType}, status: ${res.status}`,
        );
      }
    })
    .then((utxos: Array<any>) =>
      utxos.map((utxo) => {
        return {
          txId: utxo.txid,
          outputIndex: utxo.vout,
          script: utxo.script || script,
          satoshis: utxo.value,
        };
      }),
    )
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .catch((e) => {
      console.error(`fetch ${url} failed:`, e);
      return [];
    });
  return utxos.sort((a, b) => a.satoshi - b.satoshi);
};

export const getRawTransaction = async function (
  config: ConfigService,
  wallet: WalletService,
  txid: string,
): Promise<string | Error> {
  if (config.useRpc()) {
    return rpc_getrawtransaction(config, wallet.getWalletName(), txid);
  }
  const url = `${config.getMempoolApiHost()}/api/tx/${txid}/hex`;
  return (
    fetch(url, config.withProxy())
      .then((res) => {
        if (res.status === 200) {
          return res.text();
        }
        new Error(`invalid http response code: ${res.status}`);
      })
      .then((txhex: string) => {
        return txhex;
      })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .catch((e: Error) => {
        logerror('getrawtransaction failed!', e);
        return e;
      })
  );
};

export const getConfirmations = async function (
  config: ConfigService,
  txid: string,
): Promise<
  | {
      blockhash: string;
      confirmations: number;
    }
  | Error
> {
  if (config.useRpc()) {
    return rpc_getconfirmations(config, txid);
  }

  logwarn('No supported getconfirmations', new Error());
  return {
    blockhash: '',
    confirmations: -1,
  };
};

export async function broadcast(
  config: ConfigService,
  wallet: WalletService,
  txHex: string,
): Promise<string | Error> {
  if (config.useRpc()) {
    return rpc_broadcast(config, wallet.getWalletName(), txHex);
  }

  const url = `${config.getMempoolApiHost()}/api/tx`;
  return fetch(
    url,
    config.withProxy({
      method: 'POST',
      body: txHex,
    }),
  )
    .then(async (res) => {
      const contentType = res.headers.get('content-type');
      if (contentType.includes('json')) {
        return res.json();
      } else {
        return res.text();
      }
    })
    .then(async (data) => {
      if (typeof data === 'string' && data.length === 64) {
        return data;
      } else if (typeof data === 'object') {
        throw new Error(JSON.stringify(data));
      } else if (typeof data === 'string') {
        throw new Error(data);
      }
    })
    .catch((e) => {
      logerror('broadcast failed!', e);
      return e;
    });
}
