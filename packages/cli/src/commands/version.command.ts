import { Command, CommandRunner } from 'nest-commander';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../../package.json');

/**
 * show cat-cli version command options
 */
@Command({
  name: 'version',
  description: 'Output the version number',
})
export class VersionCommand extends CommandRunner {
  constructor() {
    super();
  }

  async run(): Promise<void> {
    console.log(`v${version}`);
  }
}
