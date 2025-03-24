import { MinterType } from './minter';

export function isOpenMinter(md5: string) {
  return isOpenMinterV2(md5) || isOpenMinterV1(md5);
}

export function isOpenMinterV2(md5: string) {
  return MinterType.OPEN_MINTER_V2 === md5;
}

export function isOpenMinterV1(md5: string) {
  return MinterType.OPEN_MINTER_V1 === md5;
}

export function isCAT20V2OpenMinter(md5: string) {
  return MinterType.CAT20_V2_OPEN_MINTER === md5;
}
