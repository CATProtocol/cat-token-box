# CAT Protocol SDK

This SDK package is designed for applications built on the CAT protocol. Since the entire CAT protocol is based on the Bitcoin UTXO module and intricate underlying Bitcoin script, this SDK simplifies the integration of CAT20 & CAT721 tokens into developers’ products.

## Usage

The SDK offers three distinct layers of abstraction that developers can utilize to construct their own applications, tailored to meet their specific requirements.

### Features

On a high level, this SDK offers some fundamental functionalities to interact with CAT20 and CAT721 protocol tokens, including Deploy, Mint, Transfer, and Burn. These APIs can be found in the [src/features](https://github.com/CATProtocol/cat-token-box/tree/main/packages/sdk/src/features) folder.

### Covenants

On a middle level, this SDK introduces an abstraction called the `Covenant`, which merges the capabilities of the underlying smart contracts and Taproot technology. These covenants are meticulously designed to be modular and composable, enabling the creation of arbitrary transactions to implement customized logic. They can be compared to the building blocks that constitute a feature.

### Contracts

On a fundamental level, this SDK offers all the essential smart contracts written in the `sCrypt` DSL, which can be compiled into Bitcoin scripts and utilized in covenants. If you’re interested in learning how to create your own on-chain smart contracts, you should thoroughly examine these contracts in the [src/contracts](https://github.com/CATProtocol/cat-token-box/tree/main/packages/sdk/src/contracts) folder.

## Installation

```bash
npm i @cat-protocol/cat-sdk
```

## Build Locally

```sh
yarn install && yarn build
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

![](https://raw.githubusercontent.com/CATProtocol/cat-token-box/refs/heads/main/packages/sdk/static/cat-token-protocol.svg)
