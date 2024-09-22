import { isAbsolute, join } from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';



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
  rpc: {
    url: string;
    username: string;
    password: string;
  } | null;
  verify?: boolean;
  proxy?: string;
  apiKey?: string;
}

export class ConfigService {
  cliConfig: CliConfig = {
    network: 'fractal-mainnet',
    tracker: 'http://127.0.0.1:3000',
    dataDir: '.',
    feeRate: -1,
    maxFeeRate: -1,
    rpc: null,
  };

  mergeCliConfig(one: CliConfig) {
    const rpc = {};
    if (this.cliConfig.rpc !== null) {
      Object.assign(rpc, this.cliConfig.rpc);
    }

    if (one.rpc !== null && typeof one.rpc === 'object') {
      Object.assign(rpc, one.rpc);
    }

    Object.assign(this.cliConfig, one);

    if (Object.keys(rpc).length > 0) {
      Object.assign(this.cliConfig, {
        rpc: rpc,
      });
    }
  }

  loadCliConfig(config: CliConfig): Error | null {
    this.mergeCliConfig(config);
    return null;
  }

  getCliConfig(): CliConfig {
    return this.cliConfig;
  }

  getOpenApiHost = () => {
    const config = this.getCliConfig();
    if (config.network === 'fractal-testnet') {
      return 'https://open-api-fractal-testnet.unisat.io';
    } else if (config.network === 'fractal-mainnet') {
      return 'https://open-api-fractal.unisat.io';
    } else {
      throw new Error(`Unsupport network: ${config.network}`);
    }
  };

  getMempoolApiHost = () => {
    const config = this.getCliConfig();
    if (config.network === 'btc-signet') {
      return 'https://mempool.space/signet';
    } else if (config.network === 'fractal-testnet') {
      return 'https://mempool-testnet.fractalbitcoin.io';
    } else if (config.network === 'fractal-mainnet') {
      return 'https://mempool.fractalbitcoin.io';
    } else {
      throw new Error(`Unsupport network: ${config.network}`);
    }
  };

  getProxy = () : string => {
    const config = this.getCliConfig();
    return config.proxy || '';
  };

  getTracker = () => {
    const config = this.getCliConfig();
    return config.tracker;
  };

  getApiKey = () => {
    const config = this.getCliConfig();
    return config.apiKey;
  };

  getFeeRate = () => {
    const config = this.getCliConfig();
    return config.feeRate;
  };

  getMaxFeeRate = () => {
    const config = this.getCliConfig();
    return config.maxFeeRate;
  };

  getVerify = () => {
    const config = this.getCliConfig();
    return config.verify || false;
  };

  getRpc = (): null | {
    url: string;
    username: string;
    password: string;
  } => {
    const config = this.getCliConfig();
    return config.rpc;
  };

  getRpcUser = () => {
    const config = this.getCliConfig();
    if (config.rpc !== null) {
      return config.rpc.username;
    }

    throw new Error(`No rpc config found`);
  };

  getRpcPassword = () => {
    const config = this.getCliConfig();
    if (config.rpc !== null) {
      return config.rpc.password;
    }

    throw new Error(`No rpc config found`);
  };

  getRpcUrl = (wallet: string | null) => {
    const config = this.getCliConfig();
    if (config.rpc !== null) {
      return wallet === null
        ? config.rpc.url
        : `${config.rpc.url}/wallet/${wallet}`;
    }
    throw new Error(`No rpc config found`);
  };

  useRpc = () => {
    const rpc = this.getRpc();
    return rpc !== null;
  };

  getNetwork = () => {
    const config = this.getCliConfig();
    return config.network;
  };

  isFractalNetwork = () => {
    const config = this.getCliConfig();
    return config.network.startsWith('fractal');
  };

  getDataDir(): string {
    const config = this.getCliConfig();
    const dataDir = config.dataDir;
    if (dataDir) {
      return isAbsolute(dataDir) ? dataDir : join(process.cwd(), dataDir);
    } else {
      return process.cwd();
    }
  }

  withProxy(options?: object) {
    if (this.getProxy()) {
      Object.assign({}, options, {
        agent: new HttpsProxyAgent(this.getProxy()),
      });
    }
    return options;
  }
}
