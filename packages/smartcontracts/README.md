# CAT Protocol Smart Contracts

## Installation

```bash
yarn install
```

## Build

```sh
yarn build
```

## Testing Locally

```sh
yarn test
```

## Sample Transactions

Sample token contract address is [bc1plhz9wf0desgz8t32xm67vay9hgdmrnwzjzujgg0k9883cfxxgkzs20qfd5](https://mempool.fractalbitcoin.io/address/bc1plhz9wf0desgz8t32xm67vay9hgdmrnwzjzujgg0k9883cfxxgkzs20qfd5)

- A transaction with 2 token UTXO inputs and 1 token UTXO output, with a virtual size (vsize) of 3.9k. The transaction ID (txid) is [2537706ed1000d5dd3a28d79a95ade8f674fd3e25c020cbcf97fd1b1e86ec8ef](https://mempool.fractalbitcoin.io/tx/2537706ed1000d5dd3a28d79a95ade8f674fd3e25c020cbcf97fd1b1e86ec8ef).

- A transaction with 1 token UTXO input and 2 token UTXO outputs, with a virtual size (vsize) of 2.6k. The transaction ID (txid) is [94e3254c1237ba7cd42eaeeae713c646ee5dd1cd6c4dd6ef07241d5336cd2aa7](https://mempool.fractalbitcoin.io/tx/94e3254c1237ba7cd42eaeeae713c646ee5dd1cd6c4dd6ef07241d5336cd2aa7).

## CAT Token Transaction Limits

For a CAT Token protocol transaction, the maximum number of inputs is `6`, and the maximum number of outputs is also `6`.

Since we need to calculate the txid of the previous transaction, we must ensure the previous transaction’s data is within `520` bytes.

This is because the maximum byte limit for an element on the Bitcoin Virtual Machine (BVM) stack is [520](https://github.com/bitcoin/bitcoin/blob/master/src/script/script.h#L27). The corresponding constant name is `MAX_SCRIPT_ELEMENT_SIZE`.

## CAT Protocol

![](static/cat-token-protocol.svg)
