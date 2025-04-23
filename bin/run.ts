import yargs, { CommandModule } from 'yargs'
import 'dotenv/config'
import { commands } from '../src'
import { bgBlue, bold, red } from 'picocolors'

const run = yargs(process.argv.slice(2))
run.usage(
  bgBlue(
    `Welcome to the ${bold(red('PR Commit AI Agent'))}!
    See more on https://github.com/meabed/pr-commit-agent`,
  ),
)
for (const command of commands) {
  run.command(command as CommandModule)
}

run.demandCommand(1, 'You need at least one command before moving on').help().argv
