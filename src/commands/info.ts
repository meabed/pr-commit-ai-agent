/**
 * This module implements the 'info' command, which displays information about
 * the current repository, system, and configuration. It supports a detailed view
 * with the `--full` option.
 */

import { ArgumentsCamelCase, Argv } from 'yargs';
import { logger } from '../logger';
import * as process from 'node:process';
import { blue, bold, gray, green, red, yellow } from 'picocolors';
import { configInstance } from '../config';

interface InfoArgv {
  full?: boolean;
}

export const command = 'info';
export const describe = 'Basic command to display information.';
export const aliases = ['i'];

export function builder(yargs: Argv): Argv<InfoArgv> {
  return yargs.option('full', {
    type: 'boolean',
    alias: 'f',
    default: true
  });
}

export async function handler(argv: ArgumentsCamelCase<InfoArgv>) {
  logger.info(bold(red('[INFO] Basic command to display information.')));
  logger.info(green('[INFO] Node:'), bold(process.version));
  logger.info(yellow('[INFO] Processor architecture:'), process.arch);
  logger.info(blue('[INFO] Current dir:'), process.cwd());
  logger.info(gray('[INFO] Memory usage:'), process.memoryUsage());
  logger.info(gray('[INFO] Argv:'), argv);
  if (argv.full) {
    logger.box(gray(bold('[INFO] Process config:')), process.config);
  }
  logger.info(`[INFO] Config path: ${configInstance.path}`);
}
