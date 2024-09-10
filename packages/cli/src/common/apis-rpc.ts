import { UTXO } from 'scrypt-ts';
import { Decimal } from 'decimal.js';
import * as descriptors from '@bitcoinerlab/descriptors';
import { logerror } from './log';
import { ConfigService } from 'src/providers';
import fetch from 'node-fetch-cjs';

/**
 * only for localhost
 * @param txHex
 * @returns
 */
export const rpc_broadcast = async function (
  config: ConfigService,
  walletName: string,
  txHex: string,
): Promise<string | Error> {
  const Authorization = `Basic ${Buffer.from(
    `${config.getRpcUser()}:${config.getRpcPassword()}`,
  ).toString('base64')}`;

  return fetch(config.getRpcUrl(walletName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'cat-cli',
      method: 'sendrawtransaction',
      params: [txHex],
    }),
  })
    .then((res) => {
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
      if (res.result === null) {
        throw new Error(JSON.stringify(res));
      }
      return res.result;
    })
    .catch((e) => {
      return e;
    });
};

export const rpc_getrawtransaction = async function (
  config: ConfigService,
  walletName: string,
  txid: string,
): Promise<string | Error> {
  const Authorization = `Basic ${Buffer.from(
    `${config.getRpcUser()}:${config.getRpcPassword()}`,
  ).toString('base64')}`;

  return fetch(config.getRpcUrl(walletName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'cat-cli',
      method: 'getrawtransaction',
      params: [txid],
    }),
  })
    .then((res) => {
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
      if (res.result === null) {
        throw new Error(JSON.stringify(res));
      }
      return res.result;
    })
    .catch((e) => {
      logerror('broadcast_rpc failed!', e);
      return e;
    });
};

export const rpc_getconfirmations = async function (
  config: ConfigService,
  txid: string,
): Promise<
  | {
      blockhash: string;
      confirmations: number;
    }
  | Error
> {
  const Authorization = `Basic ${Buffer.from(
    `${config.getRpcUser()}:${config.getRpcPassword()}`,
  ).toString('base64')}`;

  return fetch(config.getRpcUrl(null), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'cat-cli',
      method: 'getrawtransaction',
      params: [txid, true],
    }),
  })
    .then((res) => {
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
      if (res.result === null) {
        throw new Error(JSON.stringify(res));
      }
      return {
        confirmations: -1,
        blockhash: '',
        ...res.result,
      };
    })
    .catch((e) => {
      return e;
    });
};

export const rpc_getfeeRate = async function (
  config: ConfigService,
  walletName: string,
): Promise<number | Error> {
  const Authorization = `Basic ${Buffer.from(
    `${config.getRpcUser()}:${config.getRpcPassword()}`,
  ).toString('base64')}`;

  return fetch(config.getRpcUrl(walletName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'cat-cli',
      method: 'estimatesmartfee',
      params: [1],
    }),
  })
    .then((res) => {
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
      if (
        res.result === null ||
        (res.result.errors && res.result.errors.length > 0)
      ) {
        throw new Error(JSON.stringify(res));
      }
      const feerate = new Decimal(res.result.feerate)
        .mul(new Decimal(100000000))
        .div(new Decimal(1000))
        .toNumber();
      return Math.ceil(feerate);
    })
    .catch((e: Error) => {
      return e;
    });
};

export const rpc_listunspent = async function (
  config: ConfigService,
  walletName: string,
  address: string,
): Promise<UTXO[] | Error> {
  const Authorization = `Basic ${Buffer.from(
    `${config.getRpcUser()}:${config.getRpcPassword()}`,
  ).toString('base64')}`;

  return fetch(config.getRpcUrl(walletName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'cat-cli',
      method: 'listunspent',
      params: [0, 9999999, [address]],
    }),
  })
    .then((res) => {
      if (res.status === 200) {
        return res.json();
      }
      throw new Error(res.statusText);
    })
    .then((res: any) => {
      if (res.result === null) {
        throw new Error(JSON.stringify(res));
      }

      const utxos: UTXO[] = res.result.map((item: any) => {
        return {
          txId: item.txid,
          outputIndex: item.vout,
          script: item.scriptPubKey,
          satoshis: new Decimal(item.amount)
            .mul(new Decimal(100000000))
            .toNumber(),
        } as UTXO;
      });

      return utxos;
    })
    .catch((e: Error) => {
      return e;
    });
};

export const rpc_create_watchonly_wallet = async function (
  config: ConfigService,
  walletName: string,
): Promise<null | Error> {
  const Authorization = `Basic ${Buffer.from(
    `${config.getRpcUser()}:${config.getRpcPassword()}`,
  ).toString('base64')}`;

  return fetch(config.getRpcUrl(null), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'cat-cli',
      method: 'createwallet',
      params: {
        wallet_name: walletName,
        disable_private_keys: true,
        blank: true,
        passphrase: '',
        descriptors: true,
        load_on_startup: true,
      },
    }),
  })
    .then((res) => {
      if (res.status === 200) {
        return res.json();
      }
      throw new Error(res.statusText);
    })
    .then((res: any) => {
      if (res.result === null) {
        throw new Error(JSON.stringify(res));
      }
      return null;
    })
    .catch((e: Error) => {
      return e;
    });
};

export const rpc_importdescriptors = async function (
  config: ConfigService,
  walletName: string,
  desc: string,
): Promise<null | Error> {
  const Authorization = `Basic ${Buffer.from(
    `${config.getRpcUser()}:${config.getRpcPassword()}`,
  ).toString('base64')}`;

  const checksum = descriptors.checksum(desc);

  const timestamp = Math.ceil(new Date().getTime() / 1000);
  return fetch(config.getRpcUrl(walletName), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'cat-cli',
      method: 'importdescriptors',
      params: [
        [
          {
            desc: `${desc}#${checksum}`,
            active: false,
            index: 0,
            internal: false,
            timestamp,
            label: '',
          },
        ],
      ],
    }),
  })
    .then((res) => {
      if (res.status === 200) {
        return res.json();
      }
      throw new Error(res.statusText);
    })
    .then((res: any) => {
      if (
        res.result === null ||
        res.result[0] === undefined ||
        res.result[0].success !== true
      ) {
        throw new Error(JSON.stringify(res));
      }
      return null;
    })
    .catch((e: Error) => {
      return e;
    });
};
