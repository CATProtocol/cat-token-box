import { bitcoin, testnet, regtest, Network } from 'bitcoinjs-lib/src/networks';

export class Constants {
  static readonly BLOCK_PROCESSING_INTERVAL = 10000;

  static readonly CACHE_MAX_SIZE = 10000;

  static readonly TOKEN_INFO_CACHE_BLOCKS_THRESHOLD = 120;

  static readonly TAPROOT_LOCKING_SCRIPT_LENGTH = 34;

  static readonly PUBKEY_HASH_BYTES = 20;

  static readonly STATE_HASH_BYTES = 20;

  static readonly STATE_ROOT_HASH_BYTES = 20;

  static readonly STATE_ROOT_HASH_OFFSET = 6;

  static readonly CONTRACT_INPUT_WITNESS_MIN_SIZE = 5;

  static readonly CONTRACT_INPUT_WITNESS_STATE_HASHES_OFFSET = 0;

  static readonly CONTRACT_OUTPUT_MAX_COUNT = 5;

  static readonly COMMIT_INPUT_WITNESS_MIN_SIZE =
    this.CONTRACT_INPUT_WITNESS_MIN_SIZE;

  static readonly MINTER_INPUT_WITNESS_MIN_SIZE =
    this.CONTRACT_INPUT_WITNESS_MIN_SIZE + 2; // addr amount

  static readonly MINTER_INPUT_WITNESS_ADDR_OFFSET = 5;

  static readonly MINTER_INPUT_WITNESS_AMOUNT_OFFSET = 6;

  static readonly TOKEN_INFO_ENVELOPE = /OP_0 OP_IF 636174 OP_1 (.*?) OP_ENDIF/;

  static readonly TOKEN_AMOUNT_MAX_BYTES = 4;

  static readonly GUARD_INPUT_WITNESS_MIN_SIZE =
    this.CONTRACT_INPUT_WITNESS_MIN_SIZE + 3 * this.CONTRACT_OUTPUT_MAX_COUNT; // addr[] amount[] mask[]

  static readonly TRANSFER_GUARD_ADDR_OFFSET = 5;

  static readonly TRANSFER_GUARD_AMOUNT_OFFSET =
    this.TRANSFER_GUARD_ADDR_OFFSET + this.CONTRACT_OUTPUT_MAX_COUNT;

  static readonly TRANSFER_GUARD_MASK_OFFSET =
    this.TRANSFER_GUARD_AMOUNT_OFFSET + this.CONTRACT_OUTPUT_MAX_COUNT;

  static readonly QUERY_PAGING_DEFAULT_OFFSET = 0;
  static readonly QUERY_PAGING_DEFAULT_LIMIT = 100;
  static readonly QUERY_PAGING_MAX_LIMIT = 500;
}

const _network = process.env.NETWORK || 'mainnet';

export let network: Network;
switch (_network) {
  case 'mainnet':
    network = bitcoin;
    break;
  case 'regtest':
    network = regtest;
    break;
  default:
    network = testnet;
    break;
}
