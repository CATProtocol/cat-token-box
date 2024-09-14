import { MinterType } from './minter';

export function isOpenMinter(md5: string) {
  return MinterType.OPEN_MINTER_V1 === md5 || MinterType.OPEN_MINTER_V2 === md5;
}

export function getOpenMinterVersion(md5: string) {
  switch (md5) {
    case MinterType.OPEN_MINTER_V1:
      return 1;
    case MinterType.OPEN_MINTER_V2:
      return 2;
    default:
      throw new Error('Unknow OpenMinter version');
  }
}