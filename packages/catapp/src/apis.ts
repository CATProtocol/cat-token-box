import fetch from 'cross-fetch';
import { logerror } from './log';
import { ConfigService } from './configService';

export const getRawTransaction = async function (
  config: ConfigService,
  txid: string,
): Promise<string | Error> {
  const url = `${config.getMempoolApiHost()}/api/tx/${txid}/hex`;
  return (
    fetch(url, config.withProxy())
      .then((res) => {
        if (res.status === 200) {
          return res.text();
        }
        new Error(`invalid http response code: ${res.status}`);
      })
      .then((txhex: string | undefined) => {
        return txhex as string;
      })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .catch((e: Error) => {
        logerror('getrawtransaction failed!', e);
        return e;
      })
  );
};


export async function broadcast(
  config: ConfigService,
  txHex: string,
): Promise<string | Error> {

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
      if (contentType && contentType.includes('json')) {
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
