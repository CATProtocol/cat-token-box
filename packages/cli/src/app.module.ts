import { Module } from '@nestjs/common';
import { DeployCommand } from './commands/deploy/deploy.command';
import { MintCommand } from './commands/mint/mint.command';
import { SendCommand } from './commands/send/send.command';
import { WalletCommand } from './commands/wallet/wallet.command';
import { ConfigService, SpendService, WalletService } from './providers';
import { RetryQuestions } from './questions/retry-send.question';
import { VersionCommand } from './commands/version.command';

@Module({
  imports: [],
  controllers: [],
  providers: [
    WalletService,
    ConfigService,
    SpendService,
    VersionCommand,
    RetryQuestions,
    DeployCommand,
    MintCommand,
    SendCommand,
    ...WalletCommand.registerWithSubCommands(),
  ],
})
export class AppModule {}
