import { isAbsolute, join } from 'path';

export type SupportedNetwork =
  | 'btc-signet'
  | 'fractal-mainnet'
  | 'fractal-testnet';
export interface CliConfig {
  network: SupportedNetwork;
  tracker: string;
  dataDir: string;
  maxFeeRate?: number;
  feeRate?: number;
  rpc?: {
    url: string;
    username: string;
    password: string;
  };
  verify?: boolean;
  proxy?: string;
  apiKey?: string;
}

export const resolveConfigPath = (val: string) => {
  if (val) {
    return isAbsolute(val) ? val : join(process.cwd(), val);
  } else {
    return join(process.cwd(), 'config.json');
  }
};
