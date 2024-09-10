import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  OpenMinterTokenInfo,
  TokenMetadata,
  TokenInfo,
  scaleByDecimals,
  getTokenMetadata,
  logerror,
} from 'src/common';
import { ConfigService } from 'src/providers';

export function scaleConfig(config: OpenMinterTokenInfo): OpenMinterTokenInfo {
  const clone = Object.assign({}, config);

  clone.max = scaleByDecimals(config.max, config.decimals);
  clone.premine = scaleByDecimals(config.premine, config.decimals);
  clone.limit = scaleByDecimals(config.limit, config.decimals);

  return clone;
}

export function getAllTokenMetadatas(config: ConfigService): TokenMetadata[] {
  const path = getTokenMetadataPath(config);

  try {
    if (existsSync(path)) {
      const tokens = JSON.parse(readFileSync(path).toString()) as Array<any>;

      // eslint-disable-next-line prettier/prettier
      tokens.forEach((token) => {
        if (token.info.max) {
          // convert string to  bigint
          token.info.max = BigInt(token.info.max);
          token.info.premine = BigInt(token.info.premine);
          token.info.limit = BigInt(token.info.limit);
        }
      });
      return tokens;
    } else {
      return [];
    }
  } catch (error) {
    logerror('getAllTokenMetadatas failed!', error);
  }

  return [];
}

export async function findTokenMetadataById(
  config: ConfigService,
  id: string,
): Promise<TokenMetadata | null> {
  const tokens = getAllTokenMetadatas(config);
  let token = tokens.find((token) => token.tokenId === id);
  if (token) {
    return token;
  }

  token = await getTokenMetadata(config, id);

  if (token) {
    saveTokenMetadata(token, config);
  }

  return token;
}

function saveTokenMetadata(
  token: TokenMetadata,
  config: ConfigService,
): TokenMetadata[] {
  const tokens = getAllTokenMetadatas(config);
  tokens.push(token);
  const path = getTokenMetadataPath(config);
  try {
    writeFileSync(path, JSON.stringify(tokens, null, 1));
  } catch (error) {
    console.error('save token metadata error:', error);
  }

  return tokens;
}

export function addTokenMetadata(
  config: ConfigService,
  tokenId: string,
  info: TokenInfo,
  tokenAddr: string,
  minterAddr: string,
  genesisTxid: string,
  revealTxid: string,
) {
  const metadata: TokenMetadata = {
    info: info,
    tokenId,
    tokenAddr: tokenAddr,
    minterAddr: minterAddr,
    genesisTxid,
    revealTxid,
    timestamp: new Date().getTime(),
  };
  saveTokenMetadata(metadata, config);
  return metadata;
}

export function getTokenMetadataPath(config: ConfigService) {
  return join(config.getDataDir(), 'tokens.json');
}
