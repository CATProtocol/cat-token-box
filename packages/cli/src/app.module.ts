import { Module } from '@nestjs/common';
import { DeployCommand } from './commands/deploy/deploy.command';
import { MintCommand } from './commands/mint/mint.command';
import { SendCommand } from './commands/send/send.command';
import { WalletCommand } from './commands/wallet/wallet.command';
import { ConfigService, SpendService, WalletService } from './providers';
import { RetryQuestions } from './questions/retry-send.question';
import { VersionCommand } from './commands/version.command';
import { BurnCommand } from './commands/burn/burn.command';
import { BurnConfirmQuestion } from './questions/burn-confirm.question';
import { DeployNftCommand } from './commands/deployNft/deployNft.command';
import { MintNftCommand } from './commands/mintNft/mintNft.command';
import { SendNftCommand } from './commands/sendNft/sendNft.command';
import { BurnNftConfirmQuestion } from './questions/burnNft-confirm.question';
import { BurnNftCommand } from './commands/burnNft/burnNft.command';
import { AirdropCommand } from './commands/airdrop/airdrop.command';

@Module({
  imports: [],
  controllers: [],
  providers: [
    WalletService,
    ConfigService,
    SpendService,
    VersionCommand,
    RetryQuestions,
    BurnConfirmQuestion,
    BurnNftConfirmQuestion,
    DeployCommand,
    DeployNftCommand,
    MintCommand,
    MintNftCommand,
    SendCommand,
    SendNftCommand,
    BurnCommand,
    BurnNftCommand,
    AirdropCommand,
    ...WalletCommand.registerWithSubCommands(),
  ],
})
export class AppModule {}
