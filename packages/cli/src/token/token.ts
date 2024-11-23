import { Cat20TokenInfo, OpenMinterCat20Meta } from '@cat-protocol/cat-sdk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { scaleByDecimals, getTokenInfo, logerror } from 'src/common';
import { ConfigService } from 'src/providers';

export function scaleMetadata(
  metadata: OpenMinterCat20Meta,
): OpenMinterCat20Meta {
  const clone = Object.assign({}, metadata);
  clone.max = scaleByDecimals(metadata.max, metadata.decimals);
  clone.premine = scaleByDecimals(metadata.premine, metadata.decimals);
  clone.limit = scaleByDecimals(metadata.limit, metadata.decimals);
  return clone;
}

export function getAllTokenInfos(
  config: ConfigService,
): Cat20TokenInfo<OpenMinterCat20Meta>[] {
  const path = getTokenInfosPath(config);

  try {
    if (existsSync(path)) {
      const tokens = JSON.parse(readFileSync(path).toString()) as Array<any>;

      // eslint-disable-next-line prettier/prettier
      return tokens.map((token) => {
        const { info, metadata, ...rest } = token;

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

        return {
          metadata: metadataTmp,
          ...rest,
        };
      });
    } else {
      return [];
    }
  } catch (error) {
    logerror('getAllTokenInfos failed!', error);
  }

  return [];
}

export async function findTokenInfoById(
  config: ConfigService,
  id: string,
): Promise<Cat20TokenInfo<OpenMinterCat20Meta> | null> {
  const tokens = getAllTokenInfos(config);
  let token = tokens.find((token) => token.tokenId === id);
  if (token) {
    return token;
  }

  token = await getTokenInfo(config, id);

  if (token) {
    saveTokenInfo(token, config);
  }

  return token;
}

function saveTokenInfo(
  token: Cat20TokenInfo<OpenMinterCat20Meta>,
  config: ConfigService,
): Cat20TokenInfo<OpenMinterCat20Meta>[] {
  const tokens = getAllTokenInfos(config);
  tokens.push(token);
  const path = getTokenInfosPath(config);
  try {
    writeFileSync(path, JSON.stringify(tokens, null, 1));
  } catch (error) {
    console.error('save token metadata error:', error);
  }

  return tokens;
}

export function addTokenInfo(
  config: ConfigService,
  tokenId: string,
  metadata: OpenMinterCat20Meta,
  tokenAddr: string,
  minterAddr: string,
  genesisTxid: string,
  revealTxid: string,
): Cat20TokenInfo<OpenMinterCat20Meta> {
  const tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta> = {
    metadata: metadata,
    tokenId,
    tokenAddr: tokenAddr,
    minterAddr: minterAddr,
    genesisTxid,
    revealTxid,
    timestamp: new Date().getTime(),
  };
  saveTokenInfo(tokenInfo, config);
  return tokenInfo;
}

export function getTokenInfosPath(config: ConfigService) {
  return join(config.getDataDir(), 'tokens.json');
}
