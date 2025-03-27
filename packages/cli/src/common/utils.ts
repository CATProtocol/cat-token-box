import {
  CAT20Covenant,
  CAT721Covenant,
  CAT721MerkleLeaf,
  CAT721OpenMinterMerkleTreeData,
  getCatNFTCommitScript,
  HEIGHT,
  scriptToP2tr,
} from '@cat-protocol/cat-sdk-v2';

import { Int32 } from '@scrypt-inc/scrypt-ts-btc';

import Decimal from 'decimal.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logerror } from './log';

export function getCat20ContractP2TR(minterP2TR: string) {
  return new CAT20Covenant(minterP2TR).lockingScriptHex;
}

export function getCat721ContractP2TR(minterP2TR: string) {
  return new CAT721Covenant(minterP2TR).lockingScriptHex;
}

export function scaleByDecimals(amount: bigint, decimals: number) {
  return amount * BigInt(Math.pow(10, decimals));
}

export function unScaleByDecimals(amount: bigint, decimals: number): string {
  return new Decimal(amount.toString().replace('n', ''))
    .div(Math.pow(10, decimals))
    .toFixed(decimals);
}

export function needRetry(e: Error) {
  return (
    e instanceof Error &&
    (e.message.includes('txn-mempool-conflict') ||
      e.message.includes('bad-txns-inputs-missingorspent') ||
      e.message.includes('Transaction already in block chain') ||
      e.message.includes('mempool min fee not met'))
  );
}

const INT32_MAX = 2147483647n;

export const MAX_TOTAL_SUPPLY = INT32_MAX;

export function checkTokenInfo(info: any): Error | null {
  if (typeof info.name === 'undefined') {
    return new Error(`No token name provided!`);
  }

  if (typeof info.name !== 'string') {
    return new Error(`Invalid token name!`);
  }

  if (typeof info.symbol === 'undefined') {
    return new Error(`No token symbol provided!`);
  }

  if (typeof info.symbol !== 'string') {
    return new Error(`Invalid token symbol!`);
  }

  if (typeof info.decimals === 'undefined') {
    return new Error(`No token decimals provided!`);
  }

  if (typeof info.decimals !== 'number') {
    return new Error(`Invalid token decimals!`);
  }

  if (info.decimals < 0) {
    return new Error(`decimals should >= 0!`);
  }

  if (typeof info.max === 'undefined') {
    return new Error(`No token max supply provided!`);
  }

  if (typeof info.max === 'string') {
    try {
      info.max = BigInt(info.max);
    } catch (error) {
      return error;
    }
  } else if (typeof info.max !== 'bigint') {
    return new Error(`Invalid token max supply!`);
  }

  if (typeof info.limit === 'undefined') {
    return new Error(`No token limit provided!`);
  }

  if (typeof info.limit === 'string') {
    try {
      info.limit = BigInt(info.limit);
    } catch (error) {
      return error;
    }
  } else if (typeof info.limit !== 'bigint') {
    return new Error(`Invalid token limit!`);
  }

  if (typeof info.premine === 'undefined') {
    return new Error(`No token premine provided!`);
  }

  if (typeof info.premine === 'string') {
    try {
      info.premine = BigInt(info.premine);
    } catch (error) {
      return error;
    }
  } else if (typeof info.premine !== 'bigint') {
    return new Error(`Invalid token premine!`);
  }

  if (info.max * BigInt(Math.pow(10, info.decimals)) > MAX_TOTAL_SUPPLY) {
    return new Error(`Exceeding the max supply of (2^31 - 1)!`);
  }
}

export function checkNftMetadata(info: any): Error | null {
  if (typeof info.name === 'undefined') {
    return new Error(`No nft name provided!`);
  }

  if (typeof info.name !== 'string') {
    return new Error(`Invalid nft name!`);
  }

  if (typeof info.symbol === 'undefined') {
    return new Error(`No nft symbol provided!`);
  }

  if (typeof info.symbol !== 'string') {
    return new Error(`Invalid nft symbol!`);
  }

  if (typeof info.max === 'undefined') {
    return new Error(`No nft max supply provided!`);
  }

  if (typeof info.max === 'string') {
    try {
      info.max = BigInt(info.max);
    } catch (error) {
      return error;
    }
  } else if (typeof info.max !== 'bigint') {
    return new Error(`Invalid nft max supply!`);
  }

  if (typeof info.premine === 'string') {
    try {
      info.premine = BigInt(info.premine);
    } catch (error) {
      return error;
    }
  }
}

const createMerkleLeaf = function (
  pubkeyX: string,
  localId: bigint,
  metadata: object,
  content: {
    type: string;
    body: string;
  },
): CAT721MerkleLeaf {
  const commitScript = getCatNFTCommitScript(pubkeyX, metadata, content);
  const lockingScript = Buffer.from(commitScript, 'hex');
  const { p2trLockingScript } = scriptToP2tr(lockingScript);
  return {
    commitScript: p2trLockingScript,
    localId: localId,
    isMined: false,
  };
};

export const generateCollectionMerkleTree = function (
  max: bigint,
  pubkeyX: string,
  type: string,
  resourceDir: string,
) {
  const nftMerkleLeafList: CAT721MerkleLeaf[] = [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, ext] = type.split('/');
  if (!ext) {
    throw new Error(`unknow type: ${type}`);
  }
  for (let index = 0n; index < max; index++) {
    const body = readFileSync(join(resourceDir, `${index}.${ext}`)).toString(
      'hex',
    );

    const metadata = {
      localId: index,
    };

    try {
      const metadataFile = join(resourceDir, `${index}.json`);

      if (existsSync(metadataFile)) {
        const str = readFileSync(metadataFile).toString();
        const obj = JSON.parse(str);
        Object.assign(metadata, obj);
      }
    } catch (error) {
      logerror(`readMetaData FAIL, localId: ${index}`, error);
    }

    nftMerkleLeafList.push(
      createMerkleLeaf(pubkeyX, index, metadata, {
        type,
        body,
      }),
    );
  }

  return new CAT721OpenMinterMerkleTreeData(nftMerkleLeafList, HEIGHT);
};

export function updateMerkleTree(
  collectionMerkleTree: CAT721OpenMinterMerkleTreeData,
  max: Int32,
  nextLocalId: Int32,
) {
  for (let i = 0n; i < max; i++) {
    if (i < nextLocalId) {
      const oldLeaf = collectionMerkleTree.getLeaf(Number(i));
      const newLeaf: CAT721MerkleLeaf = {
        commitScript: oldLeaf.commitScript,
        localId: oldLeaf.localId,
        isMined: true,
      };
      collectionMerkleTree.updateLeaf(newLeaf, Number(i));
    }
  }
}
