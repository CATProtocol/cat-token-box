import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse, Method } from 'axios';
import * as http from 'http';
import * as https from 'https';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

@Injectable()
export class RpcService {
  private readonly logger = new Logger(RpcService.name);

  private readonly rpcHost: string;
  private readonly rpcPort: string;
  private readonly rpcUser: string;
  private readonly rpcPassword: string;
  private readonly rpcUrl: string;
  private readonly headers: any;

  constructor(private configService: ConfigService) {
    this.rpcHost = this.configService.get('rpcHost');
    this.rpcPort = this.configService.get('rpcPort');
    this.rpcUser = this.configService.get('rpcUser');
    this.rpcPassword = this.configService.get('rpcPassword');
    this.rpcUrl = `http://${this.rpcHost}:${this.rpcPort}`;
    this.headers = {
      'Content-Type': 'text/plain',
      Authorization:
        'Basic ' +
        Buffer.from(this.rpcUser + ':' + this.rpcPassword).toString('base64'),
    };
  }

  private async rpc(
    data: any,
    logException: boolean = true,
    throwException: boolean = false,
  ) {
    try {
      const method: Method = 'POST';
      const config = {
        method: method,
        maxBodyLength: Infinity,
        url: this.rpcUrl,
        headers: this.headers,
        data: data,
        httpAgent: httpAgent,
        httpsAgent: httpsAgent,
      };
      return await axios.request(config);
    } catch (e) {
      const _msg = `rpc error, ${e.message}, ${JSON.stringify(data)}`;
      if (logException) {
        this.logger.error(_msg);
      }
      if (throwException) {
        throw new Error(_msg);
      }
    }
  }

  public async getBlockHash(height: number) {
    const now = Date.now();
    const rpcData = {
      jsonrpc: '1.0',
      id: now,
      method: 'getblockhash',
      params: [height],
    };
    return this.rpc(rpcData, false);
  }

  public async getBlockHeader(
    blockHash: any,
  ): Promise<AxiosResponse<any> | undefined> {
    const now = Date.now();
    const rpcData = {
      jsonrpc: '1.0',
      id: now,
      method: 'getblockheader',
      params: [blockHash],
    };
    return this.rpc(rpcData);
  }

  public async getBlock(
    blockHash: string,
    verbose: number = 0,
  ): Promise<AxiosResponse<any> | undefined> {
    const now = Date.now();
    const rpcData = {
      jsonrpc: '1.0',
      id: now,
      method: 'getblock',
      params: [blockHash, verbose],
    };
    return this.rpc(rpcData);
  }

  public async getBlockchainInfo(
    logException: boolean = true,
    throwException: boolean = false,
  ) {
    const now = Date.now();
    const rpcData = {
      jsonrpc: '1.0',
      id: now,
      method: 'getblockchaininfo',
      params: [],
    };
    return this.rpc(rpcData, logException, throwException);
  }
}
