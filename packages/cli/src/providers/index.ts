import { Module } from '@nestjs/common';
import { ConfigService } from './configService';
import { WalletService } from './walletService';
import { SpendService } from './spendService';

@Module({
  providers: [ConfigService, WalletService, SpendService],
})
export class Providers {}

export * from './configService';
export * from './walletService';
export * from './spendService';
