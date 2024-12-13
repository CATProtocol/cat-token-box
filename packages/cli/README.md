# CAT CLI

`cli` requires a synced [tracker](../tracker/README.md).

## Installation

```bash
yarn install
```

## Build

```sh
yarn build
```

## Usage

1. Copy [config.example.json](config.example.json) as `config.json`. Update `config.json` with your own configuration.

All commands use the `config.json` in the current working directory by default. You can also specify a customized configuration file with `--config=your.json`.

2. Create a wallet

```bash
yarn cli wallet create
```

You should see an output similar to:

```
? What is the mnemonic value of your account? (default: generate a new mnemonic) ********
Your wallet mnemonic is:  ********
exporting address to the RPC node ... 
successfully.
```

3. Show address

```bash
yarn cli wallet address
```

You should see an output similar to:

```
Your address is bc1plfkwa8r7tt8vvtwu0wgy2m70d6cs7gwswtls0shpv9vn6h4qe7gqjjjf86
```

4. Fund your address

Deposit some satoshis to your address.


5. Show token balances

```bash
yarn cli wallet balances
```

You should see an output similar to:

```
┌──────────────────────────────────────────────────────────────────────┬────────┬─────────┐
│ tokenId                                                              │ symbol │ balance │
┼──────────────────────────────────────────────────────────────────────┼────────┼─────────┤
│ '45ee725c2c5993b3e4d308842d87e973bf1951f5f7a804b21e4dd964ecd12d6b_0' │ 'CAT'  │ '18.89' │
┴──────────────────────────────────────────────────────────────────────┴────────┴─────────┘
```

6. Deploy token

- deploy with a metadata json:

```bash
yarn cli deploy --metadata=example.json
```

`example.json`:

```json
{
    "name": "cat",
    "symbol": "CAT",
    "decimals": 2,
    "max": "21000000",
    "limit": "5",
    "premine": "0"
}
```

- deploy with command line options:

```bash
yarn cli deploy --name=cat --symbol=CAT --decimals=2 --max=21000000 --premine=0 --limit=5
```

You should see an output similar to:

```
Token CAT has been deployed.
TokenId: 45ee725c2c5993b3e4d308842d87e973bf1951f5f7a804b21e4dd964ecd12d6b_0
Genesis txid: 45ee725c2c5993b3e4d308842d87e973bf1951f5f7a804b21e4dd964ecd12d6b
Reveal txid: 9a3fcb5a8344f53f2ba580f7d488469346bff9efe7780fbbf8d3490e3a3a0cd7
```

> **Note:** `max` * 10^`decimals` must be less than 2^31, since Bitcoin Script only supports 32-bit signed integers. We plan to support 64 or higher bit in the future.


7. Mint token

When `amount` is not specified, `limit` number of tokens will be minted.
```bash
yarn cli mint -i [tokenId] [amount?]
```
You should see an output similar to:

```
Minting 5.00 CAT tokens in txid: 4659529141de4996ad8482910ef3e0cf63665c39e62b86f17d5d398b5748b66b ...
```

> **Note:** There is a slight chance you happen to use the same minter UTXO with another user who is also minting at the same time, and your mint attempt fails due to [UTXO contention](https://catprotocol.org/cat20#parallel-mint). Just retry till you succeed.


8. Send token

```bash
yarn cli send -i [tokenId] [receiver] [amount]
```
You should see an output similar to:

```
Sending 1.11 CAT tokens to bc1pmc274s6lalf6afrll2e23m2qmk50dwaj6srjupe5vyu4dcy66zyss2r3dy
in txid: 94e3254c1237ba7cd42eaeeae713c646ee5dd1cd6c4dd6ef07241d5336cd2aa7
```

9. Airdrop

```bash
yarn cli airdrop -i [tokenId] -f airdrop.csv
```
You should see an output similar to:

```
start airdrop ...
onProcess: 1/499, txid: c6bee1c9484937ba8701711247ed7fa5e5a187b83c3ff4f2795ba3df7d16e172
onProcess: 2/499, txid: c6bee1c9484937ba8701711247ed7fa5e5a187b83c3ff4f2795ba3df7d16e172
onProcess: 3/499, txid: c6bee1c9484937ba8701711247ed7fa5e5a187b83c3ff4f2795ba3df7d16e172
onProcess: 4/499, txid: 5f6502b17bfaa080a6002cabc6123e1900c67dc347bcaaffe49bc3205b6feed2
onProcess: 5/499, txid: 5f6502b17bfaa080a6002cabc6123e1900c67dc347bcaaffe49bc3205b6feed2
onProcess: 6/499, txid: 5f6502b17bfaa080a6002cabc6123e1900c67dc347bcaaffe49bc3205b6feed2
onProcess: 7/499, txid: abf0ecf83d2fb124b98ce27cdb16ee0ac77f2f73a9721185c7be430299b0451f
```

csv file format should be:

```
1,bc1p6evveuszz3uw727y4f7aue2xy78vxklyqv0xz67cknnzf7vp5fzs5vyy59
11,bc1ppq6ge7fu3jx0rjmtghcex39zxxd36dv4nxk9rmjh0hpeevzhh2wsdfe8p3
2,bc1pl423pfc5egrdr6qt8ldy8ljj5xs2mw0g06874m5c8jcgttff3j3qp8dyed
11,bc1pga2qqcnsnuh6yn0mcchfyd3mvskgmrtkk5rzcm6vthq7yxh3cwrs270msv
111,bc1pamudrantpxhzmfg23reechlg4utmzv9m2pur6jnz5kgawxxkwphswf8zxj
122,bc1pfegaugmkr8k8v6hucq65z39psvgy3l0qrnuwv8z7tl6z9mhw8ydq8rzu5w
133,bc1prqz43hf7p2jqj58qnwxc5qlc2ydx0yfq4mp5ew5r37fnvsvqzn0s6gd5s9
```


Each line contains an amount and an address field.


-----------------

### FeeRate

`deploy`, `mint`, and `send` commands can all specify a fee rate via option `--fee-rate`.