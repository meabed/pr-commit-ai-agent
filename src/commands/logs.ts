/**
 * This module implements the 'logs' command, which allows users to view and manage
 * logs of requests and responses to/from the LLM. It supports viewing, deleting,
 * and navigating through log files interactively.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../logger';
import { blue, bold, green, red, yellow } from 'picocolors';
import { logDir } from '../services/llm';

export const command = 'logs';
export const describe = 'View requests logs and responses to/from the LLM';
export const aliases = ['l'];

export async function handler() {
  logger.info(bold(blue('[LOGS-VIEWER] LLM Request Logs Viewer')));
  logger.info(yellow(`[LOGS-VIEWER] Looking for logs in: ${logDir}`));

  try {
    // Ensure the log directory exists
    try {
      await fs.access(logDir);
    } catch (error) {
      logger.error(red(`[LOGS-VIEWER] Log directory does not exist: ${logDir}`));
      logger.info(
        yellow('[LOGS-VIEWER] No logs have been created yet. Use --log-request flag with commands to generate logs.')
      );
      return;
    }

    // Initialize viewer loop
    await viewLogsLoop();
  } catch (error) {
    logger.error(red(`[LOGS-VIEWER] Error in logs handler: ${(error as Error).message}`));
  }
}

/**
 * Main log viewer loop that shows available log files and allows user to select them
 */
async function viewLogsLoop(): Promise<void> {
  let exitLoop = false;

  while (!exitLoop) {
    const logFiles = await getLogFiles();

    if (logFiles.length === 0) {
      logger.info(yellow('[LOGS-VIEWER] No log files found.'));
      logger.info(yellow('[LOGS-VIEWER] Use --log-request flag with commands to generate logs.'));
      return;
    }

    // Add delete all logs and exit options to the list
    const options = [...logFiles.map((file) => file.name), 'Delete all logs', 'Exit log viewer'];

    const selection = await logger.prompt(yellow('[LOGS-VIEWER] Select a log file to view:'), {
      type: 'select',
      options
    });

    if (typeof selection === 'undefined') {
      exitLoop = true;
      continue;
    }

    // Handle special options
    if (selection === 'Exit log viewer') {
      exitLoop = true;
      continue;
    }

    if (selection === 'Delete all logs') {
      await handleDeleteAllLogs();
      // Check if there are still logs after deletion
      const remainingLogs = await getLogFiles();
      if (remainingLogs.length === 0) {
        logger.info(green('[LOGS-VIEWER] All logs have been deleted.'));
        return;
      }
      continue;
    }

    // Find the selected log file info
    const selectedFile = logFiles.find((file) => file.name === selection);
    if (selectedFile) {
      await displayLogFile(selectedFile.path);
    }
  }

  logger.info(green('[LOGS-VIEWER] Exited log viewer.'));
}

/**
 * Delete all log files in the log directory
 */
async function handleDeleteAllLogs(): Promise<void> {
  // Ask for confirmation before deleting
  const confirmDelete = await logger.prompt(
    red('[LOGS-VIEWER] Are you sure you want to delete ALL log files? This cannot be undone.'),
    {
      type: 'confirm'
    }
  );

  if (!confirmDelete) {
    logger.info(yellow('[LOGS-VIEWER] Deletion cancelled.'));
    return;
  }

  try {
    // Get all files in the log directory
    const files = await fs.readdir(logDir);

    // Filter only relevant log files
    const logFiles = files.filter((file) => file.startsWith('request-') || file.startsWith('llm-requests-'));

    if (logFiles.length === 0) {
      logger.info(yellow('[LOGS-VIEWER] No log files to delete.'));
      return;
    }

    // Delete each file
    let deletedCount = 0;
    for (const file of logFiles) {
      const filePath = path.join(logDir, file);
      try {
        await fs.unlink(filePath);
        deletedCount++;
      } catch (error) {
        logger.error(red(`[LOGS-VIEWER] Failed to delete file ${file}: ${(error as Error).message}`));
      }
    }

    logger.info(green(`[LOGS-VIEWER] Successfully deleted ${deletedCount} log files.`));
  } catch (error) {
    logger.error(red(`[LOGS-VIEWER] Failed to delete logs: ${(error as Error).message}`));
  }
}

/**
 * Get all available log files with their metadata
 */
async function getLogFiles(): Promise<Array<{ name: string; path: string; timestamp: Date }>> {
  try {
    // Get all files in the log directory
    const files = await fs.readdir(logDir);

    // Filter only relevant log files
    const logFiles = files.filter((file) => file.startsWith('request-') || file.startsWith('llm-requests-'));

    // Get file stats for sorting by modification time
    const fileStats = await Promise.all(
      logFiles.map(async (file) => {
        const filePath = path.join(logDir, file);
        const stats = await fs.stat(filePath);
        return {
          name: file,
          path: filePath,
          timestamp: stats.mtime
        };
      })
    );

    // Sort by modification time, most recent first
    return fileStats.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (error) {
    logger.error(red(`[LOGS-VIEWER] Failed to read log files: ${(error as Error).message}`));
    return [];
  }
}

/**
 * Display the contents of a selected log file
 */
async function displayLogFile(filePath: string): Promise<void> {
  try {
    // Read the file
    const content = await fs.readFile(filePath, 'utf8');

    // Determine if it's a JSONL file or a single JSON file
    if (path.basename(filePath).startsWith('llm-requests-')) {
      // JSONL file with multiple entries
      const lines = content.trim().split('\n');
      logger.info(green(`[LOGS-VIEWER] Found ${lines.length} log entries in this file.`));

      // Display each entry
      for (let i = 0; i < lines.length; i++) {
        const entryLine = lines?.[i]?.trim();
        if (entryLine) {
          const entry = JSON.parse(entryLine);
          logger.info(bold(blue(`\n[LOGS-VIEWER] === Log Entry ${i + 1} ===`)));
          displayLogEntry(entry);

          // If there are more entries, prompt to continue
          if (i < lines.length - 1) {
            const continueViewing = await logger.prompt(yellow('[LOGS-VIEWER] View next entry?'), {
              type: 'confirm'
            });

            if (!continueViewing) break;
          }
        }
      }
    } else {
      // Single JSON file
      const entry = JSON.parse(content);
      displayLogEntry(entry);
    }
  } catch (error) {
    logger.error(red(`[LOGS-VIEWER] Failed to display log file: ${(error as Error).message}`));
  }

  // Wait for user to continue
  await logger.prompt(yellow('[LOGS-VIEWER] Press Enter to continue...'), {
    type: 'text'
  });
}

/**
 * Display a single log entry in a formatted way
 */
function displayLogEntry(entry: {
  id: string;
  provider: string;
  model: string;
  timestamp: Date;
  executionTimeMs?: number;
  options?: {
    prompt?: string;
    [key: string]: unknown;
  };
  error?: string;
  response?: string;
}): void {
  logger.box({
    title: `[LOGS-VIEWER] LLM Request - ${entry.id}`,
    provider: entry.provider,
    model: entry.model,
    timestamp: entry.timestamp,
    executionTime: entry.executionTimeMs ? `${entry.executionTimeMs}ms` : 'N/A'
  });

  // Display the prompt
  if (entry.options?.prompt) {
    logger.info(bold(yellow('[LOGS-VIEWER] Prompt:')));
    logger.info(entry.options.prompt.substring(0, 20000) + (entry.options.prompt.length > 20000 ? '...' : ''));
  }

  // Display error if present
  if (entry.error) {
    logger.info(bold(red('[LOGS-VIEWER] Error:')));
    logger.info(red(entry.error));
    return;
  }

  // Display the response
  if (entry.response) {
    logger.info(bold(green('[LOGS-VIEWER] Response:')));
    logger.info(entry.response.substring(0, 20000) + (entry.response.length > 20000 ? '...' : ''));
  }
}
