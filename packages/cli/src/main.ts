import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';
import { logerror, MinterType } from './common';
import { OpenMinter } from '@cat-protocol/cat-smartcontracts';
export const ArtifactsMD5 = new Map<string, MinterType>();

export async function bootstrap() {
  try {
    ArtifactsMD5.set(OpenMinter.getArtifact().md5, MinterType.OPEN_MINTER);
    await CommandFactory.run(AppModule);
  } catch (error) {
    logerror('bootstrap failed!', error);
  }
}

if (require.main === module) {
  bootstrap();
}
