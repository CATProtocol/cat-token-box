import { DefaultSigner } from '@scrypt-inc/scrypt-ts-btc';
import { ErrorDefaultSigner, ErrorPair } from './errorSigner';

const pair = new ErrorPair();
export const testSigner = new DefaultSigner(pair);
export const testErrorSigner = new ErrorDefaultSigner(pair);
