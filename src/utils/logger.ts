import chalk from 'chalk';
import * as ora from 'ora';

/**
 * Logger utility for consistent console output
 */
export class Logger {
  private verbose: boolean;
  private spinner: ReturnType<typeof ora.default> | null = null;
  
  /**
   * Create a new Logger
   * @param verbose Whether to show verbose logs
   */
  constructor(verbose = false) {
    this.verbose = verbose;
  }
  
  /**
   * Log an info message
   * @param message Message to log
   */
  info(message: string): void {
    console.log(chalk.blue('ℹ ') + message);
  }
  
  /**
   * Log a success message
   * @param message Message to log
   */
  success(message: string): void {
    console.log(chalk.green('✓ ') + message);
  }
  
  /**
   * Log an error message
   * @param message Message to log
   */
  error(message: string): void {
    console.error(chalk.red('✖ ') + message);
  }
  
  /**
   * Log a warning message
   * @param message Message to log
   */
  warn(message: string): void {
    console.warn(chalk.yellow('⚠ ') + message);
  }
  
  /**
   * Log a debug message (only in verbose mode)
   * @param message Message to log
   */
  debug(message: string): void {
    if (this.verbose) {
      console.debug(chalk.gray('🔍 ') + message);
    }
  }
  
  /**
   * Start a spinner with a message
   * @param message Message to show with spinner
   */
  startSpinner(message: string): void {
    this.spinner = ora.default(message).start();
  }
  
  /**
   * Update the spinner message
   * @param message New message
   */
  updateSpinner(message: string): void {
    if (this.spinner) {
      this.spinner.text = message;
    }
  }
  
  /**
   * Stop the spinner with success
   * @param message Success message
   */
  stopSpinnerSuccess(message: string): void {
    if (this.spinner) {
      this.spinner.succeed(message);
      this.spinner = null;
    }
  }
  
  /**
   * Stop the spinner with failure
   * @param message Failure message
   */
  stopSpinnerFail(message: string): void {
    if (this.spinner) {
      this.spinner.fail(message);
      this.spinner = null;
    }
  }
}