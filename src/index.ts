#!/usr/bin/env node

import { Command } from 'commander';
import { executeGenerateCommand } from './commands/generate.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

// Get package version from package.json in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
);

// Create the command-line program
const program = new Command();

// Set up program information
program
  .name('commit-pr-agent')
  .description('A CLI tool that uses LLMs to generate commit messages, PR descriptions, and create GitHub PRs')
  .version(packageJson.version);

// Add "generate" command
program
  .command('generate')
  .description('Generate commit messages and PR descriptions from code changes')
  .option('-c, --config <path>', 'Path to config file')
  .option('-b, --branch <name>', 'Branch name to create PR from')
  .option('-d, --dry-run', 'Show what would be done without making changes', false)
  .option('-v, --verbose', 'Show verbose output', false)
  .option('--auto-commit', 'Automatically commit changes without prompting', false)
  .option('--auto-push', 'Automatically push changes without prompting', false)
  .option('--open-pr', 'Automatically open PR in browser after creation', false)
  .action((options) => {
    executeGenerateCommand(options)
      .catch((error) => {
        console.error(`Error: ${error.message}`);
        process.exit(1);
      });
  });

// Add "init" command to create config file
program
  .command('init')
  .description('Create initial configuration file')
  .action(() => {
    // This will be implemented in a separate file
    console.log('Creating configuration file...');
    console.log('This feature is not yet implemented. Please check back later.');
  });

// Parse command line arguments
program.parse();

// If no arguments provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}