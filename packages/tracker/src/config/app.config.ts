// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

export const appConfig = () => ({
  rpcHost: process.env.RPC_HOST,
  rpcPort: process.env.RPC_PORT,
  rpcUser: process.env.RPC_USER,
  rpcPassword: process.env.RPC_PASSWORD,

  genesisBlockHeight: Math.max(
    parseInt(process.env.GENESIS_BLOCK_HEIGHT || '2'),
    2,
  ),
});
