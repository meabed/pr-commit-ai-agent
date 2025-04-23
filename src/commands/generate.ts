import inquirer from 'inquirer';
import { GitService } from '../services/git.service.js';
import { LLMService } from '../services/llm.service.js';
import { GitHubService } from '../services/github.service.js';
import { Logger } from '../utils/logger.js';
import { CommandOptions, Config, LLMResult } from '../types/index.js';
import { getConfig } from '../config/config.js';

/**
 * Execute the generate command
 * @param options Command options
 */
export async function executeGenerateCommand(options: CommandOptions): Promise<void> {
  const logger = new Logger(options.verbose);
  
  try {
    // Get configuration
    const config = getConfig(options.configPath);
    
    // Initialize services
    const gitService = new GitService();
    const llmService = new LLMService(config);
    const githubService = new GitHubService(config);
    
    // Get Git changes
    logger.startSpinner('Analyzing git repository...');
    const changes = await gitService.getChanges();
    logger.debug(`Current branch: ${changes.branch}`);
    
    // If no uncommitted changes and no unpushed commits, exit
    if (!changes.uncommittedChanges && changes.unpushedCommits.length === 0) {
      logger.stopSpinnerFail('No changes to analyze');
      logger.warn('No uncommitted changes or unpushed commits found');
      return;
    }
    
    if (changes.uncommittedChanges) {
      logger.debug(`Uncommitted changes found in files: ${changes.changedFiles.join(', ')}`);
    }
    
    if (changes.unpushedCommits.length > 0) {
      logger.debug(`Found ${changes.unpushedCommits.length} unpushed commit(s)`);
    }
    
    // Update GitHub owner/repo if not set in config
    if (!config.github.owner || !config.github.repo) {
      try {
        const repoInfo = await gitService.getRepoInfo();
        config.github.owner = repoInfo.owner;
        config.github.repo = repoInfo.repo;
        logger.debug(`Detected repository: ${config.github.owner}/${config.github.repo}`);
      } catch (error) {
        logger.warn(`Could not detect repository information: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Generate summary with LLM
    logger.updateSpinner('Generating summary with LLM...');
    const llmResult = await llmService.generateChangeSummary(changes);
    logger.stopSpinnerSuccess('Analysis complete');
    
    // Display results
    if (llmResult.commitMessage) {
      logger.info('\nGenerated Commit Message:');
      console.log(`${llmResult.commitMessage}\n`);
    }
    
    if (llmResult.prTitle) {
      logger.info('Generated PR Title:');
      console.log(`${llmResult.prTitle}\n`);
    }
    
    if (llmResult.prDescription) {
      logger.info('Generated PR Description:');
      console.log(`${llmResult.prDescription}\n`);
    }
    
    // Ask user for next actions
    const actions = await promptActions(changes.uncommittedChanges, llmResult);
    
    // Execute actions based on user choices
    if (actions.shouldCommit && changes.uncommittedChanges) {
      logger.startSpinner('Committing changes...');
      const commitResult = await gitService.commit(llmResult.commitMessage || '');
      logger.stopSpinnerSuccess(`Changes committed: ${commitResult}`);
    }
    
    if (actions.shouldPush) {
      logger.startSpinner('Pushing changes to remote...');
      await gitService.push();
      logger.stopSpinnerSuccess('Changes pushed successfully');
    }
    
    if (actions.shouldCreatePr) {
      // Check if PR already exists
      const prExists = await githubService.pullRequestExists(changes.branch);
      if (prExists) {
        logger.warn('A pull request for this branch already exists');
      } else {
        logger.startSpinner('Creating pull request...');
        const prResult = await githubService.createPullRequest({
          head: changes.branch,
          title: llmResult.prTitle || '',
          body: llmResult.prDescription || ''
        });
        logger.stopSpinnerSuccess(`Pull request created: #${prResult.number}`);
        logger.info(`URL: ${prResult.url}`);
        
        // Open the PR in browser if requested
        if (actions.shouldOpenPr) {
          githubService.openPullRequest(prResult.url);
        }
      }
    }
    
  } catch (error) {
    logger.stopSpinnerFail('Operation failed');
    logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (options.verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Type for user actions response
 */
interface UserActions {
  shouldCommit?: boolean;
  shouldPush: boolean;
  shouldCreatePr?: boolean;
  shouldOpenPr?: boolean;
}

/**
 * Prompt the user for actions to take
 * @param hasUncommittedChanges Whether there are uncommitted changes
 * @param llmResult The result from the LLM
 * @returns Actions to perform
 */
async function promptActions(hasUncommittedChanges: boolean, llmResult: LLMResult): Promise<UserActions> {
  const questions = [];
  
  if (hasUncommittedChanges && llmResult.commitMessage) {
    questions.push({
      type: 'confirm',
      name: 'shouldCommit',
      message: 'Do you want to commit these changes with the generated message?',
      default: false
    });
  }
  
  questions.push({
    type: 'confirm',
    name: 'shouldPush',
    message: 'Do you want to push the changes to remote?',
    default: false
  });
  
  if (llmResult.prTitle && llmResult.prDescription) {
    questions.push({
      type: 'confirm',
      name: 'shouldCreatePr',
      message: 'Do you want to create a pull request with the generated title and description?',
      default: false
    });
    
    questions.push({
      type: 'confirm',
      name: 'shouldOpenPr',
      message: 'Do you want to open the pull request in your browser?',
      default: true,
      when: (answers: { shouldCreatePr: boolean }) => answers.shouldCreatePr
    });
  }
  
  return await inquirer.prompt(questions) as UserActions;
}