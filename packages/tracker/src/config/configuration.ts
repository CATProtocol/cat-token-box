// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

export default () => ({
  rpcHost: process.env.BITCOIND_RPC_HOST,
  rpcPort: process.env.BITCOIND_RPC_PORT,
  rpcUser: process.env.BITCOIND_RPC_USER,
  rpcPassword: process.env.BITCOIND_RPC_PASSWORD,

  genesisBlockHeight: Math.max(
    parseInt(process.env.CAT_PROTOCOL_GENESIS_BLOCK_HEIGHT || '2'),
    2,
  ),
});
