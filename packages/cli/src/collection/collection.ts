import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Cat721Metadata, Cat721NftInfo } from '@cat-protocol/cat-sdk-v2';
import { getCollectionInfo, logerror } from 'src/common';
import { ConfigService } from 'src/providers';

export function getAllCollectionInfos(
  config: ConfigService,
): Cat721NftInfo<Cat721Metadata>[] {
  const path = getCollectionInfoPath(config);

  try {
    if (existsSync(path)) {
      const bigintKeys = ['max', 'premine'];
      const collectionInfos = JSON.parse(
        readFileSync(path).toString(),
        (key, value) => {
          if (bigintKeys.includes(key)) {
            return BigInt(value);
          }
          return value;
        },
      ) as Array<any>;
      return collectionInfos;
    } else {
      return [];
    }
  } catch (error) {
    logerror('getAllCollectionInfos failed!', error);
  }

  return [];
}

export async function findCollectionInfoById(
  config: ConfigService,
  id: string,
): Promise<Cat721NftInfo<Cat721Metadata> | null> {
  const collectionInfos = getAllCollectionInfos(config);
  let collectionInfo = collectionInfos.find(
    (collection) => collection.collectionId === id,
  );
  if (collectionInfo) {
    return collectionInfo;
  }

  collectionInfo = await getCollectionInfo(config, id);

  if (collectionInfo) {
    saveCollectionInfo(collectionInfo, config);
  }

  return collectionInfo;
}

function saveCollectionInfo(
  collectionInfo: Cat721NftInfo<Cat721Metadata>,
  config: ConfigService,
): Cat721NftInfo<Cat721Metadata>[] {
  const collectionInfos = getAllCollectionInfos(config);
  collectionInfos.push(collectionInfo);
  const path = getCollectionInfoPath(config);
  try {
    writeFileSync(
      path,
      JSON.stringify(
        collectionInfos,
        (key, value) => {
          if (typeof value === 'bigint') {
            return value.toString(); // Convert BigInt to string
          }
          return value; // Return other values unchanged
        },
        1,
      ),
    );
  } catch (error) {
    console.error('save token metadata error:', error);
  }

  return collectionInfos;
}

export function addCollectionInfo(
  config: ConfigService,
  collectionId: string,
  collectionMetadata: Cat721Metadata,
  collectionAddr: string,
  minterAddr: string,
  genesisTxid: string,
  revealTxid: string,
) {
  const collectionInfo: Cat721NftInfo<Cat721Metadata> = {
    metadata: collectionMetadata,
    collectionId,
    collectionAddr,
    minterAddr: minterAddr,
    genesisTxid,
    revealTxid,
  };
  saveCollectionInfo(collectionInfo, config);
  return collectionInfo;
}

export function getCollectionInfoPath(config: ConfigService) {
  return join(config.getDataDir(), 'collections.json');
}
