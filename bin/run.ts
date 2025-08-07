import yargs, { type CommandModule, type Options } from 'yargs';
import 'dotenv/config';
import { bgBlue, bold, red } from 'picocolors';
import { hideBin } from 'yargs/helpers';
import { commands } from '../src';

const run = yargs(hideBin(process.argv));

run.usage(
  bgBlue(
    `Welcome to the ${bold(red('PR Commit AI Agent'))}!
    See more on https://github.com/meabed/pr-commit-agent`
  )
);

const firstCommand = commands[0] as unknown as Required<CommandModule>;
run.command(
  [firstCommand.command.toString(), '$0'],
  firstCommand.describe.toString(),
  firstCommand.builder as { [key: string]: Options },
  firstCommand.handler
);

for (const command of commands) {
  run.command(command as CommandModule);
}

run.help().argv;
