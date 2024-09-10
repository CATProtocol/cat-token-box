import { accessSync, constants } from 'fs';
import { Option, CommandRunner } from 'nest-commander';
import { CliConfig, logerror, resolveConfigPath } from 'src/common';
import { WalletService } from 'src/providers';
import { ConfigService } from 'src/providers/configService';
import { URL } from 'url';
export interface BaseCommandOptions {
  config?: string;
  network?: string;
  tracker?: string;
  dataDir?: string;
  rpcurl?: string;
  rpcusername?: string;
  rpcpassword?: string;
}

export abstract class BaseCommand extends CommandRunner {
  constructor(
    protected readonly walletService: WalletService,
    protected readonly configService: ConfigService,
    protected readonly autoLoadWallet: boolean = true,
  ) {
    super();
  }

  abstract cat_cli_run(
    passedParams: string[],
    options?: Record<string, any>,
  ): Promise<void>;

  async run(
    passedParams: string[],
    options?: BaseCommandOptions,
  ): Promise<void> {
    const configPath = resolveConfigPath(options?.config || '');

    const error = this.configService.loadCliConfig(configPath);

    if (error instanceof Error) {
      console.warn('WARNING:', error.message);
    }

    const cliConfig = this.takeConfig(options);

    this.configService.mergeCliConfig(cliConfig);

    if (this.autoLoadWallet) {
      const wallet = this.walletService.loadWallet();

      if (wallet === null) {
        return;
      }
    }

    return this.cat_cli_run(passedParams, options);
  }

  protected takeConfig(options: BaseCommandOptions): CliConfig {
    /**
     * {
     *   network: 'fractal-mainnet',
     *   trackerApiHost: 'http://127.0.0.1:3000',
     *   dataDir: '.',
     *   apiHost: {
     *     url: 'http://127.0.0.1:8332',
     *     username: '',
     *     password: '',
     *    }
     * }
     */
    const cliConfig = {};

    if (options.network) {
      Object.assign(cliConfig, {
        network: options.network,
      });
    }

    if (options.dataDir) {
      Object.assign(cliConfig, {
        dataDir: options.dataDir,
      });
    }

    if (options.tracker) {
      Object.assign(cliConfig, {
        tracker: options.tracker,
      });
    }

    const rpc = null;

    if (options.rpcurl) {
      Object.assign(rpc, {
        url: options.rpcurl,
      });
    }

    if (options.rpcusername) {
      Object.assign(rpc, {
        username: options.rpcusername,
      });
    }

    if (options.rpcpassword) {
      Object.assign(rpc, {
        password: options.rpcpassword,
      });
    }

    if (rpc !== null) {
      Object.assign(cliConfig, {
        rpc: rpc,
      });
    }

    return cliConfig as CliConfig;
  }

  @Option({
    flags: '-c, --config [config file]',
    description: 'Special a config file',
  })
  parseConfig(val: string): string {
    const configPath = resolveConfigPath(val);
    try {
      accessSync(configPath, constants.R_OK | constants.W_OK);
      return configPath;
    } catch (error) {
      logerror(`can\'t access config file: ${configPath}`, error);
      process.exit(-1);
    }
  }

  @Option({
    flags: '-d, --datadir [datadir]',
    description: 'Special a data dir',
  })
  parseDataDir(val: string): string {
    return val;
  }

  @Option({
    flags: '-n, --network [network]',
    description: 'Special a network',
    choices: ['fractal-mainnet', 'fractal-testnet', 'btc-signet'],
  })
  parseNetwork(val: string): string {
    if (
      val === 'fractal-mainnet' ||
      val === 'fractal-testnet' ||
      val === 'btc-signet'
    ) {
      return val;
    }
    throw new Error(`Invalid network: \'${val}\'\n`);
  }

  @Option({
    flags: '-t, --tracker [tracker]',
    description: 'Special a tracker URL',
  })
  parseTracker(val: string): string {
    try {
      new URL(val);
    } catch (error) {
      throw new Error(`Invalid tracker URL:${val}\n`);
    }
    return val;
  }

  @Option({
    flags: '--rpc-url [rpcurl]',
    description: 'Special a rpc URL',
  })
  parseRpcUrl(val: string): string {
    try {
      new URL(val);
    } catch (error) {
      throw new Error(`Invalid rpc URL:${val}\n`);
    }
    return val;
  }

  @Option({
    flags: '--rpc-username [rpcusername]',
    description: 'Special a rpc username',
  })
  parseRpcUsername(val: string): string {
    return val;
  }

  @Option({
    flags: '--rpc-password [rpcpassword]',
    description: 'Special a rpc password',
  })
  parseRpcPassword(val: string): string {
    return val;
  }
}
