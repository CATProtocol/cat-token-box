export const SHA256_HASH_LEN = 32n;
export const HASH256_HASH_LEN = SHA256_HASH_LEN;
export const TX_HASH_BYTE_LEN = HASH256_HASH_LEN;

export const RIPEMD160_HASH_LEN = 20n;
export const HASH160_HASH_LEN = RIPEMD160_HASH_LEN;
export const STATE_HASH_BYTE_LEN = HASH160_HASH_LEN;
export const STATE_HASH_ROOT_BYTE_LEN = HASH160_HASH_LEN;

export const X_ONLY_PUBKEY_BYTE_LEN = 32n;

// when computing the tx hash using the preimage passed in by the user in witness,
// the maximum byte length of the concatenated preimage must be considered.
// tx can have at most 6 inputs and 6 outputs,
// since the elements on the BVM stack must be less than 520 bytes.
export const TX_INPUT_COUNT_MAX = 6;
export const TX_OUTPUT_COUNT_MAX = 6;
export const TX_IO_INDEX_VAL_MIN = 0n;
export const TX_IO_INDEX_VAL_MAX = 5n;
// the first output, aka the state hash root output, is an OP_RETURN output that carries states of the other outputs.
export const STATE_OUTPUT_OFFSET = 1;
export const STATE_OUTPUT_COUNT_MAX = 5;

export const TX_HASH_PREIMAGE2_SUFFIX_ARRAY_SIZE = 3;
export const TX_HASH_PREIMAGE3_INPUT_ARRAY_SIZE = 4;
export const TX_HASH_PREIMAGE3_SUFFIX_ARRAY_SIZE = 3;

// how many different tokens can there be in a guard
export const GUARD_TOKEN_TYPE_MAX = 4;

// how many different collections can there be in a nftGuard
export const NFT_GUARD_COLLECTION_TYPE_MAX = 4;

// byte length of each part in tx
export const TX_VERSION_BYTE_LEN = 4n;
export const TX_INPUT_COUNT_BYTE_LEN = 1n;
export const TX_INPUT_PREV_TX_HASH_BYTE_LEN = TX_HASH_BYTE_LEN;
export const TX_INPUT_PREV_OUTPUT_INDEX_BYTE_LEN = 4n;
export const TX_INPUT_PREVOUT_BYTE_LEN = TX_INPUT_PREV_TX_HASH_BYTE_LEN + TX_INPUT_PREV_OUTPUT_INDEX_BYTE_LEN;
export const TX_SEGWIT_INPUT_SCRIPT_LEN_BYTE_LEN = 1n;
export const TX_INPUT_SEQUENCE_BYTE_LEN = 4n;
export const TX_SEGWIT_INPUT_BYTE_LEN =
    TX_INPUT_PREVOUT_BYTE_LEN + TX_SEGWIT_INPUT_SCRIPT_LEN_BYTE_LEN + TX_INPUT_SEQUENCE_BYTE_LEN;
export const TX_OUTPUT_COUNT_BYTE_LEN = 1n;
export const TX_OUTPUT_SATOSHI_BYTE_LEN = 8n;
export const TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN = 34n;
export const TX_LOCKTIME_BYTE_LEN = 4n;

// byte length of token owner address
// owned by user
export const OWNER_ADDR_P2WPKH_BYTE_LEN = 22n; // p2wpkh locking script
export const OWNER_ADDR_P2TR_BYTE_LEN = TX_P2TR_OUTPUT_SCRIPT_BYTE_LEN; // p2tr locking script
// owned by contract
export const OWNER_ADDR_CONTRACT_HASH_BYTE_LEN = HASH160_HASH_LEN; // contract script hash
