# CAT Token Box

A reference implementation of the `Covenant Attested Token (CAT)` protocol on BTC signet and Fractal, where `OP_CAT` is re-activated.


## Out of the Box

There are three major packages implementing the protocol and tools for `CAT` out of the box.

```bash
packages
├── cli
├── common
├── smartcontracts
└── tracker
```


* `smartcontracts`

Smart contracts implementing the `CAT` protocol written in [sCrypt](https://github.com/sCrypt-Inc/scrypt-ts).


* `tracker`

A `tracker` service that keeps track of `CAT` related UTXOs, including minter and token. It exposes them as REST APIs for application integration.

* `cli`

A `Command Line Interface (CLI)` tool that can `deploy` / `mint` / `transfer` `CAT` protocol tokens.

## Prerequisites

* Node.js Environment

Make sure you have `Node.js` >=20 and `yarn` installed.

You can follow the guide [here](https://nodejs.org/en/download/package-manager) to install `Node.js`.

Also, you can check its version use this command:

```bash
node -v
```

Use this command to install `yarn` if it's not installed:

```bash
npm i -g yarn
```

* Full Node
* Postgres Database

You can install and run the above two components on your own or follow the instructions [here](./packages/tracker/README.md#prerequisite) in `tracker` package to start them in docker containers.

## How to Run the Project

> ⚠️ **Warning:** Please only use Taproot address (starting with `bc1p`) for all CAT protocol transactions, including fee inputs, change outputs, and token owner address. Failing to do so may result in loss of funds.

### 1. Build the project

Run this command under the project's root directory to build the whole project:

```bash
yarn install && yarn build
```

## 2. Run the `tracker` service

Follow the instructions [here](./packages/tracker/README.md) to setup and start the `tracker` service.

## 3. Execute `CLI` commands

After the `tracker` syncs up to the latest block, you can execute all kinds of commands provided by the `cli` package to interact with `CAT` protocol tokens. Refer to [this document](./packages/cli/README.md) to see more details.

## Development & Test

Run this command under the root directory to run all tests from these packages:

```bash
turbo test
```
