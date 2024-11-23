import { Command, Option } from 'nest-commander';
import {
  getUtxos,
  getTokenMinter,
  logerror,
  getTokenMinterCount,
  isOpenMinter,
  unScaleByDecimals,
  MinterType,
  getTokens,
} from 'src/common';
import {
  ConfigService,
  getProviders,
  SpendService,
  WalletService,
} from 'src/providers';
import { Inject } from '@nestjs/common';
import { log } from 'console';
import { findTokenInfoById, scaleMetadata } from 'src/token';
import Decimal from 'decimal.js';
import {
  BoardcastCommand,
  BoardcastCommandOptions,
} from '../boardcast.command';
import {
  mint,
  OpenMinterCat20Meta,
  Cat20MinterUtxo,
  getRemainSupply,
  Cat20TokenInfo,
  mergeCat20Utxo,
  UtxoProvider,
  ChainProvider,
  toTokenAddress,
  btc,
} from '@cat-protocol/cat-sdk';

interface MintCommandOptions extends BoardcastCommandOptions {
  id: string;
  merge: boolean;
  new?: number;
}

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

@Command({
  name: 'mint',
  description: 'Mint a token',
})
export class MintCommand extends BoardcastCommand {
  constructor(
    @Inject() private readonly spendService: SpendService,
    @Inject() protected readonly walletService: WalletService,
    @Inject() protected readonly configService: ConfigService,
  ) {
    super(spendService, walletService, configService);
  }

  fixAmount = (
    minter: Cat20MinterUtxo,
    scaledMetadata: OpenMinterCat20Meta,
    amount?: bigint,
  ) => {
    const minterState = minter.state;
    if (minterState.isPremined && amount > scaledMetadata.limit) {
      console.error('The number of minted tokens exceeds the limit!');
      return null;
    }

    const limit = scaledMetadata.limit;

    if (!minter.state.isPremined && scaledMetadata.premine > 0n) {
      if (typeof amount === 'bigint') {
        if (amount !== scaledMetadata.premine) {
          throw new Error(
            `first mint amount should equal to premine ${scaledMetadata.premine}`,
          );
        }
      } else {
        amount = scaledMetadata.premine;
      }
    } else {
      amount = amount || limit;
      if (scaledMetadata.minterMd5 === MinterType.OPEN_MINTER_V1) {
        if (getRemainSupply(minter.state, scaledMetadata.minterMd5) < limit) {
          console.warn(
            `small limit of ${unScaleByDecimals(limit, scaledMetadata.decimals)} in the minter UTXO!`,
          );
          log(`retry to mint token [${scaledMetadata.symbol}] ...`);
          return null;
        }
        amount =
          amount > getRemainSupply(minter.state, scaledMetadata.minterMd5)
            ? getRemainSupply(minter.state, scaledMetadata.minterMd5)
            : amount;
      } else if (
        scaledMetadata.minterMd5 == MinterType.OPEN_MINTER_V2 &&
        amount != limit
      ) {
        console.warn(`can only mint at the exactly amount of ${limit} at once`);
        amount = limit;
      }
    }
    return amount;
  };
  async cat_cli_run(
    passedParams: string[],
    options?: MintCommandOptions,
  ): Promise<void> {
    try {
      if (options.id) {
        const address = await this.walletService.getAddress();
        const token = await findTokenInfoById(this.configService, options.id);

        if (!token) {
          console.error(`No token found for tokenId: ${options.id}`);
          return;
        }

        const scaledMetadata = scaleMetadata(token.metadata);

        let amount: bigint | undefined;

        if (passedParams[0]) {
          try {
            const d = new Decimal(passedParams[0]).mul(
              Math.pow(10, scaledMetadata.decimals),
            );
            amount = BigInt(d.toString());
          } catch (error) {
            logerror(`Invalid amount: "${passedParams[0]}"`, error);
            return;
          }
        }

        const { chainProvider, utxoProvider } = getProviders(
          this.configService,
          this.walletService,
        );

        const MAX_RETRY_COUNT = 10;

        for (let index = 0; index < MAX_RETRY_COUNT; index++) {
          if (options.merge) {
            await this.merge(token, utxoProvider, chainProvider, address);
          }
          const feeRate = await this.getFeeRate();
          const feeUtxos = await this.getFeeUTXOs(address);
          if (feeUtxos.length === 0) {
            console.warn('Insufficient satoshis balance!');
            return;
          }

          const count = await getTokenMinterCount(
            this.configService,
            token.tokenId,
          );

          const maxTry = count < MAX_RETRY_COUNT ? count : MAX_RETRY_COUNT;

          if (count == 0 && index >= maxTry) {
            console.error('No available minter UTXO found!');
            return;
          }

          const offset = getRandomInt(count - 1);
          const minter = await getTokenMinter(
            this.configService,
            this.spendSerivce,
            chainProvider,
            token,
            offset,
          );

          if (minter === null) {
            console.error('No available minter UTXO found!');
            continue;
          }

          if (isOpenMinter(token.metadata.minterMd5)) {
            amount = this.fixAmount(minter, scaledMetadata, amount);

            if (amount === null) {
              return;
            }

            const res = await mint(
              this.walletService,
              utxoProvider,
              chainProvider,
              minter,
              token.tokenId,
              token.metadata,
              toTokenAddress(address),
              address,
              feeRate,
            );

            const { mintTxId } = res;
            console.log(
              `Minting ${unScaleByDecimals(amount, token.metadata.decimals)} ${token.metadata.symbol} tokens in txid: ${mintTxId} ...`,
            );
            return;
          } else {
            throw new Error('unkown minter!');
          }
        }

        console.error(`mint token [${token.metadata.symbol}] failed`);
      } else {
        throw new Error('expect a ID option');
      }
    } catch (error) {
      logerror('mint failed!', error);
    }
  }

  async merge(
    tokenInfo: Cat20TokenInfo<OpenMinterCat20Meta>,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    address: btc.Addres,
  ) {
    const cat20Utxos = await getTokens(
      this.configService,
      this.spendService,
      tokenInfo,
      address,
    );

    if (cat20Utxos.length >= 4) {
      console.info(
        `Start merging your [${tokenInfo.metadata.symbol}] tokens ...`,
      );

      const feeRate = await this.getFeeRate();
      const result = await mergeCat20Utxo(
        this.walletService,
        utxoProvider,
        chainProvider,
        tokenInfo.minterAddr,
        cat20Utxos,
        feeRate,
      );

      cat20Utxos.forEach((cat20Utxo) => {
        this.spendSerivce.addSpend(cat20Utxo.utxo);
      });

      return result.cat20Utxos;
    }
  }

  @Option({
    flags: '-i, --id [tokenId]',
    description: 'ID of the token',
  })
  parseId(val: string): string {
    return val;
  }
  @Option({
    flags: '-m, --merge [merge]',
    defaultValue: false,
    description: 'merge token utxos when mint',
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMerge(val: string): boolean {
    return true;
  }

  async getFeeUTXOs(address: btc.Address) {
    let feeUtxos = await getUtxos(
      this.configService,
      this.walletService,
      address,
    );

    feeUtxos = feeUtxos.filter((utxo) => {
      return this.spendService.isUnspent(utxo);
    });

    if (feeUtxos.length === 0) {
      console.warn('Insufficient satoshis balance!');
      return [];
    }
    return feeUtxos;
  }
}
