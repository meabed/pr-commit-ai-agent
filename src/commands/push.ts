/**
 * Push Command Module
 *
 * This module implements the 'push' command which helps users create AI-assisted
 * pull requests. It provides functionality for optimizing commit messages,
 * creating branch names, generating PR titles and descriptions using AI.
 *
 * The workflow follows these steps:
 * 1. Determining the target branch for the PR
 * 2. Handling uncommitted changes with AI-suggested commit messages
 * 3. Optimizing the most recent commit message to follow best practices
 * 4. Creating and pushing a PR with AI-generated content
 */
import * as process from 'node:process';
import { logger } from '../logger';
import { green, red, yellow } from 'picocolors';
import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import { generateCompletion } from '../services/llm';
import { ArgumentsCamelCase, Argv } from 'yargs';
import { PromptOptions } from 'consola';

export const command = 'push';
export const describe = 'Create PR and push to remote';
export const aliases = ['c'];

interface PushArgv {
  yes?: boolean;
  'log-request'?: boolean;
}

/**
 * Configure command line arguments for the push command
 *
 * @param yargs - Yargs instance
 * @returns Configured yargs instance with push command options
 */
export function builder(yargs: Argv): Argv<PushArgv> {
  return yargs
    .option('yes', {
      type: 'boolean',
      alias: 'y',
      describe: 'Automatically answer yes to all confirmations',
      default: false
    })
    .option('log-request', {
      type: 'boolean',
      describe: 'Log AI requests for debugging purposes',
      default: false
    });
}

// Define global variables for confirm and logRequest
let globalConfirm: (message: string, options?: PromptOptions) => Promise<unknown>;
let globalLogRequest: boolean = false;

// Initialize global variables
export function initializeGlobals(argv: ArgumentsCamelCase<PushArgv>) {
  globalConfirm = async (message: string, options: PromptOptions = { type: 'confirm' }) => {
    if (argv.yes) {
      logger.info(yellow(`[Auto-confirmed] ${message}`));
      return true;
    }
    return await logger.prompt(green(message), options);
  };

  globalLogRequest = argv['log-request'] ?? false;
}

// Modularized function to handle git operations with error handling
async function performGitOperation<T>(operation: () => Promise<T>, errorMessage: string): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    logger.error(red(`${errorMessage}: ${(error as Error).message}`));
    return null;
  }
}

/**
 * Main handler for the push command - implements the workflow for creating an AI-assisted PR
 *
 * Guides the user through a series of steps to prepare and create a high-quality PR:
 * - Identifies the target branch
 * - Handles any uncommitted changes with AI assistance
 * - Optimizes commit messages using AI analysis
 * - Creates a new branch and PR with AI-generated metadata
 *
 * Each step requires user confirmation before proceeding, allowing the user to
 * cancel or skip steps as desired.
 */
export async function handler(argv: ArgumentsCamelCase<PushArgv>) {
  initializeGlobals(argv);

  const ready = await globalConfirm(`Are you ready to create an AI PR?`);
  if (!ready) return;

  try {
    const currentDir = process.cwd();
    if (!currentDir) {
      logger.error(red('Failed to get current working directory.'));
      return;
    }

    const git: SimpleGit = simpleGit({
      baseDir: currentDir,
      binary: 'git',
      maxConcurrentProcesses: 6
    });

    const status = await performGitOperation(() => git.status(), 'Failed to get git status');
    if (!status) return;

    logger.info(yellow('Next step: Determine the target branch for your PR'));
    const proceedWithBranch = await globalConfirm('Would you like to proceed with determining the target branch?');
    if (!proceedWithBranch) {
      logger.info(yellow('Process cancelled by user'));
      return;
    }

    const upstreamBranch = await performGitOperation(
      () => getUpstreamBranch(git, globalConfirm),
      'Failed to determine upstream branch'
    );
    if (!upstreamBranch) return;

    if (!status.isClean()) {
      logger.info(yellow('Next step: Handle uncommitted changes in your working directory'));
      const proceedWithChanges = await globalConfirm('Would you like to commit your uncommitted changes?');
      if (!proceedWithChanges) {
        logger.info(yellow('Process cancelled by user'));
        return;
      }

      await performGitOperation(
        () => handleUncommittedChanges(git, status, globalConfirm),
        'Failed to handle uncommitted changes'
      );
    } else {
      logger.info(green('Working directory is clean'));
    }

    logger.info(yellow('Next step: Optimize existing commit messages'));
    const proceedWithOptimize = await globalConfirm('Would you like to optimize your commit messages?');
    if (proceedWithOptimize) {
      await performGitOperation(
        () => optimizeCommitMessages(git, upstreamBranch, globalConfirm),
        'Failed to optimize commit messages'
      );
    } else {
      logger.info(yellow('Skipping commit message optimization'));
    }

    logger.info(yellow('Final step: Create a new branch and push PR to remote'));
    const proceedWithPR = await globalConfirm('Would you like to proceed with creating a PR?');
    if (!proceedWithPR) {
      logger.info(yellow('PR creation cancelled by user'));
      return;
    }

    await performGitOperation(
      () => createAndPushPR(git, upstreamBranch, globalConfirm),
      'Failed to create and push PR'
    );
  } catch (e) {
    logger.error(red(`Unexpected error occurred: ${(e as Error).message}`));
  }
}

/**
 * Files to exclude from diff analysis to reduce noise and focus on meaningful code changes
 *
 * Large generated files like lock files, configuration files, and binary assets are excluded
 * to ensure the AI focuses on meaningful code changes and doesn't exceed context limits.
 */
const ignoredFiles = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'tsconfig.json'];

/**
 * Namespace and message used for git notes to track commits created by this tool
 *
 * Used to identify commits that have already been processed by PR Agent,
 * preventing duplicate processing of the same commit.
 */
const PR_AGENT_NOTE_NAMESPACE = 'pr-agent';
const PR_AGENT_NOTE_MESSAGE = 'created-by-pr-agent';

/**
 * Determines the upstream branch to use as the target for PR creation
 *
 * First tries to detect the current tracking branch, and if none exists or the user declines,
 * presents a list of available remote branches to choose from. The user can then select
 * and confirm their choice before proceeding.
 *
 * @param git - SimpleGit instance for git operations
 * @param confirm - Function to handle confirmations (respects --yes flag)
 * @returns Promise resolving to the selected upstream branch name (e.g., 'origin/main')
 * @throws Error if no remote branches are found or if branch selection fails
 */
async function getUpstreamBranch(
  git: SimpleGit,
  confirm: (message: string, options?: PromptOptions) => Promise<unknown>
): Promise<string> {
  try {
    logger.info(green('Attempting to determine the upstream branch...'));

    // Try to get the tracking branch directly
    let branchInfo;
    try {
      branchInfo = await git.branch();
      if (!branchInfo || !branchInfo.current) {
        logger.error(red('Branch information is undefined or missing current branch.'));
        throw new Error('Could not determine current branch');
      }
    } catch (error) {
      logger.error(red(`Failed to get branch information: ${(error as Error).message}`));
      throw new Error('Could not determine current branch');
    }

    const trackingBranch = await git.revparse(['--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => {
      logger.info(yellow('No tracking branch found'));
      return null;
    });

    if (branchInfo.current && trackingBranch) {
      logger.info(green(`Found tracking branch: ${trackingBranch}`));
      const confirmTracking = await confirm(`Use "${trackingBranch}" as the target branch?`);

      if (confirmTracking) {
        return trackingBranch;
      } else {
        logger.info(yellow('You chose to select a different target branch'));
      }
    }

    // If no tracking branch or user declined, get remote branches and ask user
    logger.info(yellow('Fetching available remote branches...'));
    let remoteBranches;
    try {
      remoteBranches = await git.branch(['--remotes']);
      if (!remoteBranches || !remoteBranches.all) {
        logger.error(red('Remote branches information is undefined.'));
        throw new Error('Could not retrieve remote branches');
      }
    } catch (error) {
      logger.error(red(`Failed to fetch remote branches: ${(error as Error).message}`));
      throw new Error('Could not retrieve remote branches');
    }

    const branches = remoteBranches.all
      .filter((branch) => branch && !branch.includes('HEAD ->'))
      .map((branch) => branch.trim());

    if (!branches || branches.length === 0) {
      throw new Error('No remote branches found');
    }

    // Ask a user which branch to target - can't auto-confirm select
    const targetBranch = await logger.prompt(yellow('Select target branch for PR:'), {
      type: 'select',
      options: branches
    });

    if (!targetBranch) {
      logger.error(red('No branch selected.'));
      throw new Error('No branch selected');
    }

    logger.info(green(`Selected target branch: ${targetBranch}`));
    const confirmSelected = await confirm(`Confirm "${targetBranch}" as your target branch?`);

    if (!confirmSelected) {
      logger.info(yellow('Branch selection cancelled. Please start over.'));
      process.exit(0);
    }

    return targetBranch;
  } catch (error) {
    logger.error(red(`Failed to determine upstream branch: ${(error as Error).message}`));
    throw error;
  }
}

/**
 * Handles uncommitted changes in the working directory
 *
 * Uses AI to analyze file changes and generate an appropriate commit message that follows
 * a conventional commit format. The function:
 * 1. Collects all modified files (excluding ignored files)
 * 2. Gets git diff for each file and combines them for analysis
 * 3. Sends diffs to AI to generate a proper commit message
 * 4. Creates a commit with the AI-suggested message after user confirmation
 * 5. Marks the new commit with git notes to identify it as created by PR Agent
 *
 * @param git - SimpleGit instance for git operations
 * @param status - Current git status including modified, added, and deleted files
 * @param confirm - Function to handle confirmations (respects --yes flag)
 * @returns Promise resolving to commit data with the generated commit message
 * @throws Error if commit creation fails or if LLM response is invalid
 */
async function handleUncommittedChanges(
  git: SimpleGit,
  status: StatusResult,
  confirm: (message: string, options?: PromptOptions) => Promise<unknown>
) {
  logger.info(yellow('Found uncommitted changes in the working directory'));

  const proceedWithAnalysis = await confirm('Analyze changes with AI to generate a commit message?');

  if (!proceedWithAnalysis) {
    logger.info(yellow('Commit creation cancelled'));
    process.exit(0);
  }

  logger.info(yellow('Collecting modified file details for analysis...'));

  // Filter out lock files and other noise from analysis
  const modifiedFiles =
    status && Array.isArray(status.modified) ? status.modified.filter((e) => e && !ignoredFiles.includes(e)) : [];

  if (!modifiedFiles || modifiedFiles.length === 0) {
    logger.info(yellow('No modified files to analyze.'));
    return;
  }

  // Build a string containing all file diffs for AI analysis
  const tempModified = [] as string[];
  for (const file of modifiedFiles) {
    if (!file) continue;
    logger.info(yellow(`Analyzing changes in: ${file}`));
    try {
      const stagedDiff = await git.diff(['-U3', '--minimal', '--staged', file]);
      const unstagedDiff = await git.diff(['-U3', '--minimal', file]);
      const diff = stagedDiff + unstagedDiff;
      tempModified.push(`
filename: ${file}
diff changes: ${diff}
____________=========================____________
`);
    } catch (error) {
      logger.warn(yellow(`Failed to get diff for ${file}: ${(error as Error).message}`));
      // Continue with other files
    }
  }

  logger.info(yellow('Generating commit message with AI...'));
  const confirmAiRequest = await confirm('Send changes to AI for commit message suggestion?');

  if (!confirmAiRequest) {
    logger.info(yellow('AI message generation cancelled'));
    process.exit(0);
  }

  if (!tempModified || tempModified.length === 0) {
    logger.error(red('No diffs available for AI analysis.'));
    return;
  }

  const systemPrompt = `

Extra Instructions:
- Provide a better commit message that clearly describes the change using the conventional commit format
(type(scope): description). Types include: feat, fix, docs, style, refactor, perf, test, build, ci, chore.
The message should be concise, clear, and follow best practices.

Format your response as a JSON object with the following length and structure:
- commitMessage: max 120 characters
and the following structure:
{
  "commitMessage": "type(scope): summary of changes detailed explanation of changes..."
}
`;

  logger.info(green('Sending changes to LLM for commit suggestion...'));
  const res = await generateCompletion('ollama', {
    logRequest: globalLogRequest,
    prompt: `${systemPrompt}
    Git diff changes are as follows:
    ${tempModified.join('')}`
  });

  let commitData: { commitMessage: string };
  try {
    commitData = JSON.parse(res.text);
    if (!commitData.commitMessage) {
      logger.error(red('No commit message found in LLM response'));
      logger.debug('Raw response:', res);
      throw new Error('Invalid LLM response format');
    }
    logger.info(green('Got commit suggestion:'));
    logger.box({
      title: 'Commit Message',
      content: commitData.commitMessage
    });

    const commitConfirm = await confirm('Proceed with this commit?');

    if (commitConfirm) {
      logger.info(yellow('Adding all changes to git...'));
      try {
        await git.add('.');
      } catch (error) {
        logger.error(red(`Failed to add changes to git staging area: ${(error as Error).message}`));
        throw new Error('Failed to stage changes');
      }

      logger.info(yellow('Creating commit with the suggested message...'));
      try {
        const commitResult = await git.commit(commitData.commitMessage);
        // Mark this commit as created by pr-agent using git notes
        if (commitResult.commit) {
          await markCommitAsCreatedByTool(git, commitResult.commit);
        }
      } catch (error) {
        logger.error(red(`Failed to create commit: ${(error as Error).message}`));
        throw new Error('Commit creation failed');
      }

      logger.success(green('Changes committed successfully!'));
    } else {
      logger.info(yellow('Commit cancelled'));
      process.exit(0);
    }
  } catch (e) {
    logger.debug('Raw response:', res);
    logger.error(red(`Failed to parse LLM response as JSON: ${(e as Error).message}`));
    throw new Error('Invalid LLM response format');
  }

  return commitData;
}

/**
 * Marks a commit as created by the PR Agent tool using git notes
 *
 * This allows the tool to identify its own commits in later operations to avoid
 * redundant processing. Git notes are used as they don't change the commit hash
 * and are kept separate from the commit message.
 *
 * @param git - SimpleGit instance for git operations
 * @param commitHash - Hash of the commit to mark (can be a ref like 'HEAD')
 * @returns Promise that resolves when the note is added (or silently fails)
 */
async function markCommitAsCreatedByTool(git: SimpleGit, commitHash: string) {
  if (!commitHash) {
    logger.debug('No commit hash provided to markCommitAsCreatedByTool.');
    return;
  }
  try {
    logger.debug(`Marking commit ${commitHash} as created by PR Agent`);
    await git.raw(['notes', '--ref', PR_AGENT_NOTE_NAMESPACE, 'add', '-m', PR_AGENT_NOTE_MESSAGE, commitHash]);
    logger.debug(`Successfully marked commit ${commitHash}`);
  } catch (error) {
    // Don't fail the whole process if we can't add notes
    logger.debug(`Failed to mark commit with git notes: ${(error as Error).message}`);
  }
}

/**
 * Checks if a commit was created by the PR Agent tool
 *
 * Reads git notes to determine if a commit was previously created or processed
 * by this tool. This prevents duplicate processing of commits.
 *
 * @param git - SimpleGit instance for git operations
 * @param commitHash - Hash of the commit to check
 * @returns Promise resolving to boolean indicating if PR Agent created the commit
 */
async function isCommitCreatedByTool(git: SimpleGit, commitHash: string): Promise<boolean> {
  if (!commitHash) {
    logger.debug('No commit hash provided to isCommitCreatedByTool.');
    return false;
  }
  try {
    const notes = await git.raw(['notes', '--ref', PR_AGENT_NOTE_NAMESPACE, 'show', commitHash]).catch(() => '');
    return notes.includes(PR_AGENT_NOTE_MESSAGE);
  } catch (error) {
    logger.debug(`Failed to check git notes: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Optimizes commit messages for the last commit while using the full diff context
 * from upstream branch to HEAD for better analysis.
 *
 * This function:
 * 1. Gets the last commit from the current branch
 * 2. Checks if it's a merge commit or already processed by PR Agent (skips if so)
 * 3. Collects the full diff context from upstream to HEAD for comprehensive analysis
 * 4. Gets the specific changes in the last commit for focused analysis
 * 5. Sends both contexts to AI to analyze and suggest improvements
 * 6. Amends the last commit with an improved message if suggested by AI
 * 7. Marks the amended commit as processed by PR Agent
 *
 * Using both the full branch context and specific commit changes helps the AI
 * understand both the overall purpose of the PR and the specific changes made
 * in the commit, resulting in more meaningful commit messages.
 *
 * @param git - SimpleGit instance for git operations
 * @param upstreamBranch - Name of the upstream branch to compare against
 * @param confirm - Function to handle confirmations (respects --yes flag)
 * @returns Promise that resolves when optimization is complete or skipped
 */
async function optimizeCommitMessages(
  git: SimpleGit,
  upstreamBranch: string,
  confirm: (message: string, options?: PromptOptions) => Promise<unknown>
) {
  logger.info(yellow('Starting commit message optimization process...'));

  if (!upstreamBranch) {
    logger.error(red('Upstream branch is undefined.'));
    return;
  }

  // Get all commits between current HEAD and upstream branch
  logger.info(yellow('Fetching commits information...'));
  let commits;
  try {
    commits = await git.log({
      from: upstreamBranch,
      to: 'HEAD'
    });
  } catch (error) {
    logger.error(red(`Failed to get commit logs: ${(error as Error).message}`));
    throw new Error('Could not retrieve commit history');
  }

  if (!commits || !Array.isArray(commits.all) || !commits.all.length) {
    logger.info(yellow('No commits to optimize'));
    return;
  }

  logger.info(green(`Found ${commits.all.length} commit(s) in the branch`));

  // Only focus on the last commit for optimization
  const lastCommit = commits?.all?.[0];
  if (!lastCommit || !lastCommit.hash) {
    logger.info(yellow('No commits found to optimize'));
    return;
  }

  // Check if this tool created the last commit
  const isToolCommit = await isCommitCreatedByTool(git, lastCommit.hash);
  if (isToolCommit) {
    logger.info(yellow(`Last commit was already created by PR Agent, skipping optimization`));
    return;
  }

  logger.info(yellow(`Will optimize the last commit: ${lastCommit.hash.substring(0, 7)} - ${lastCommit.message}`));

  // Check if this is a merge commit (has multiple parents)
  let revList;
  try {
    revList = await git.raw(['rev-list', '--parents', '-n', '1', lastCommit.hash]);
    if (!revList) {
      logger.error(red('Failed to get parent hashes for last commit.'));
      return;
    }
  } catch (error) {
    logger.error(red(`Failed to check commit parents: ${(error as Error).message}`));
    throw new Error('Could not determine if commit is a merge commit');
  }

  const parentHashes = revList.trim().split(' ');

  if (!parentHashes || parentHashes.length === 0) {
    logger.error(red('Parent hashes are undefined or empty.'));
    return;
  }

  // If there are more than 2 entries (commit hash and parent hashes), it's a merge commit
  if (parentHashes.length > 2) {
    logger.info(yellow(`Cannot optimize merge commit: ${lastCommit.hash.substring(0, 7)}`));
    return;
  }

  const continueOptimization = await confirm('Continue with commit message optimization?');

  if (!continueOptimization) {
    logger.info(yellow('Commit message optimization cancelled'));
    return;
  }

  // Get the comprehensive diff from upstream branch to HEAD
  logger.info(yellow(`Getting full diff context from ${upstreamBranch} to HEAD for better analysis...`));
  let fullDiff;
  try {
    fullDiff = await git.diff([
      '-U3',
      '--minimal',
      upstreamBranch,
      'HEAD',
      ...ignoredFiles.map((file) => `:(exclude)${file}`),
      ':(exclude)*.generated.*',
      ':(exclude)*.lock',
      ':(exclude)tsconfig.json',
      ':(exclude)tsconfig.*.json',
      ':(exclude)*.svg',
      ':(exclude)*.png',
      ':(exclude)*.jpg',
      ':(exclude)*.jpeg'
    ]);
    if (typeof fullDiff !== 'string') {
      logger.error(red('Full diff is not a string.'));
      return;
    }
  } catch (error) {
    logger.error(red(`Failed to get full branch diff: ${(error as Error).message}`));
    throw new Error('Could not retrieve branch diff for analysis');
  }

  // Get the individual commit diff as well
  logger.info(yellow(`Also analyzing the specific commit: ${lastCommit.hash.substring(0, 7)}`));
  let commitDiff;
  try {
    commitDiff = await git.show([
      '-U3',
      '--minimal',
      lastCommit.hash,
      ...ignoredFiles.map((file) => `:(exclude)${file}`),
      ':(exclude)*.generated.*',
      ':(exclude)*.lock',
      ':(exclude)tsconfig.json',
      ':(exclude)tsconfig.*.json',
      ':(exclude)*.svg',
      ':(exclude)*.png',
      ':(exclude)*.jpg',
      ':(exclude)*.jpeg'
    ]);
    if (typeof commitDiff !== 'string') {
      logger.warn(yellow('Commit diff is not a string.'));
      commitDiff = 'Failed to retrieve specific commit diff';
    }
  } catch (error) {
    logger.error(red(`Failed to get commit diff: ${(error as Error).message}`));
    logger.info(yellow('Will continue with just the full branch diff for analysis'));
    commitDiff = 'Failed to retrieve specific commit diff';
  }

  const systemPrompt = `

First, analyze the current commit message and determine if it needs improvement based on conventional commit best practices.
Then, analyze both the full branch diff and the specific commit diff to get complete context about the changes.
If the commit needs improvement, provide a better commit message that clearly describes the change using the conventional commit format
(type(scope): description). Types include: feat, fix, docs, style, refactor, perf, test, build, ci, chore.
The message should be concise, clear, and follow best practices.

Format your response as a JSON object with the following structure:
{
  "needsImprovement": true|false,
  "reason": "Brief explanation of why the commit needs improvement or why it's already sufficient",
  "improvedCommitMessage": "type(scope): summary of changes detailed explanation of changes..."
}

The "improvedCommitMessage" should only be provided if "needsImprovement" is true, and should be max 120 characters.
`;

  // Ask LLM for a better commit message
  const promptMsg = `
Current commit message: "${lastCommit.message}"

Specific commit diff:
${commitDiff}

Full branch context (all changes from upstream to HEAD):
${fullDiff}
`;

  logger.info(yellow(`Requesting commit message analysis from AI with comprehensive context...`));
  const res = await generateCompletion('ollama', {
    logRequest: globalLogRequest,
    prompt: `${systemPrompt}${promptMsg}`
  });

  try {
    const analysis = JSON.parse(res.text);

    if (!analysis || typeof analysis !== 'object') {
      logger.error(red('AI analysis response is not an object.'));
      throw new Error('Invalid AI analysis response');
    }

    if (analysis.needsImprovement) {
      logger.info(green(`AI suggests improving the last commit message`));
      logger.box({
        title: 'Commit Message Comparison',
        current: lastCommit.message,
        improved: analysis.improvedCommitMessage,
        reason: analysis.reason
      });

      const amendConfirm = await confirm(`Amend commit ${lastCommit.hash.substring(0, 7)} with the improved message?`);

      if (amendConfirm) {
        logger.info(green(`Amending last commit ${lastCommit.hash.substring(0, 7)}...`));

        // Amend the last commit with the new message
        try {
          await git.raw(['commit', '--amend', '-m', analysis.improvedCommitMessage]);

          // Mark the amended commit as created by our tool
          await markCommitAsCreatedByTool(git, 'HEAD');

          logger.success(green(`Last commit amended successfully`));
        } catch (error) {
          logger.error(red(`Failed to amend commit: ${(error as Error).message}`));
          throw new Error('Could not amend commit message');
        }
      } else {
        logger.info(yellow(`Skipping amendment for last commit`));
      }
    } else {
      logger.info(yellow(`No changes needed for last commit: ${analysis.reason}`));
    }
  } catch (e) {
    logger.error(red(`Failed to optimize last commit: ${(e as Error).message}`));
    logger.debug('Raw response:', res);
    throw new Error('Commit message optimization failed');
  }

  // Log the updated commit message
  try {
    const updatedCommit = await git.log(['-1']);
    if (updatedCommit && updatedCommit.latest) {
      logger.info(green('Last commit after optimization:'));
      logger.info(`${updatedCommit.latest?.hash?.substring(0, 7) ?? ''} - ${updatedCommit.latest?.message ?? ''}`);
    } else {
      logger.warn(yellow('Updated commit information is undefined.'));
    }
  } catch (error) {
    logger.warn(yellow(`Failed to retrieve updated commit: ${(error as Error).message}`));
    // Not a critical error, so we don't throw
  }

  logger.success(green('Commit message optimization complete'));
}

/**
 * Creates a new branch and pushes it to remote, then creates a PR
 *
 * This function:
 * 1. Gets the latest commit message to use as context
 * 2. Generates a branch name, PR title, and description using AI
 * 3. Creates a new branch if the current branch is target branch
 * 4. Pushes the branch to the remote repository
 * 5. Either creates a PR using GitHub CLI or provides instructions for manual creation
 *
 * The AI-generated PR content is based on commit messages and follows best practices
 * for PR descriptions, including summary, changes made, and testing information.
 *
 * @param git - SimpleGit instance for git operations
 * @param upstreamBranch - Name of the upstream branch to target for the PR
 * @param confirm - Function to handle confirmations (respects --yes flag)
 * @returns Promise that resolves when PR creation is complete or canceled
 */
async function createAndPushPR(
  git: SimpleGit,
  upstreamBranch: string,
  confirm: (message: string, options?: PromptOptions) => Promise<unknown>
) {
  logger.info(green('Preparing to create a new branch and PR'));

  if (!upstreamBranch) {
    logger.error(red('Upstream branch is undefined.'));
    return;
  }

  // Get the latest commit to use for branch name suggestion and PR details
  logger.info(yellow('Fetching latest commit for PR details...'));
  let latestCommit;
  try {
    latestCommit = await git.log(['-1']);
    if (!latestCommit || !latestCommit.latest) {
      logger.error(red('Latest commit information is undefined.'));
      throw new Error('Could not retrieve latest commit information');
    }
  } catch (error) {
    logger.error(red(`Failed to get latest commit: ${(error as Error).message}`));
    throw new Error('Could not retrieve latest commit information');
  }

  const commitMessage = latestCommit.latest?.message || '';

  // Get current branch
  let branchSummary;
  try {
    branchSummary = await git.branch();
    if (!branchSummary || !branchSummary.current) {
      logger.error(red('Branch summary or current branch is undefined.'));
      throw new Error('Could not determine current branch');
    }
  } catch (error) {
    logger.error(red(`Failed to get current branch information: ${(error as Error).message}`));
    throw new Error('Could not determine current branch');
  }

  const currentBranch = branchSummary.current;

  const generatePrDetails = await confirm('Generate PR details with AI based on your commits?');

  if (!generatePrDetails) {
    logger.info(yellow('PR creation cancelled'));
    return;
  }

  // Generate PR details using LLM
  logger.info(yellow('Requesting PR suggestions from AI...'));
  // get existing branch names to exclude them from suggestions
  let existingBranches;
  try {
    existingBranches = await git.branchLocal();
    if (!existingBranches || !Array.isArray(existingBranches.all)) {
      logger.warn(yellow('Local branches information is undefined.'));
      existingBranches = { all: [] };
    }
  } catch (error) {
    logger.warn(yellow(`Failed to get local branches: ${(error as Error).message}`));
    existingBranches = { all: [] };
  }

  const existingBranchNames = Array.isArray(existingBranches.all)
    ? existingBranches.all.map((branch) => branch?.trim()).join(', ')
    : '';

  const systemPrompt = `

Exclude the following branches from suggestions: ${existingBranchNames}
Format your response as a JSON object with the following length and structure:
- suggestedBranchName: max 50 characters
- prTitle: max 100 characters
- prDescription: max 2000 characters
and the following structure:
{
  "suggestedBranchName": "feature/descriptive-name",
  "prTitle": "type(scope): PR Title",
  "prDescription": "## Summary\\n[Comprehensive description of the changes]"
}
`;

  const prPrompt = `
Based on this commit message, suggest a branch name, PR title and description for a pull request:

Commit message: ${commitMessage}
`;

  const res = await generateCompletion('ollama', {
    logRequest: globalLogRequest,
    prompt: `${systemPrompt}${prPrompt}`
  });

  let prData;
  try {
    prData = JSON.parse(res.text);

    if (
      !prData ||
      typeof prData !== 'object' ||
      !prData.suggestedBranchName ||
      !prData.prTitle ||
      !prData.prDescription
    ) {
      logger.error(red('AI PR data is missing required fields.'));
      throw new Error('Invalid PR data from AI');
    }

    // Show PR details and confirm
    logger.box({
      title: 'Pull Request Details',
      branch: prData.suggestedBranchName,
      prTitle: prData.prTitle,
      description: prData.prDescription
    });

    const createPRConfirm = await confirm('Create PR with these details?');

    if (createPRConfirm) {
      let branchToPush = currentBranch;
      const targetBranchName = upstreamBranch.replace('origin/', '');

      // Only create a new branch if the current branch is the target branch
      if (currentBranch === targetBranchName) {
        // Create a new branch
        logger.info(
          yellow(`Current branch is the same as target branch. Creating new branch: ${prData.suggestedBranchName}...`)
        );
        if (!prData.suggestedBranchName) {
          logger.error(red('Suggested branch name is undefined.'));
          return;
        }
        const createBranchConfirm = await confirm(`Confirm creation of branch "${prData.suggestedBranchName}"?`);

        if (!createBranchConfirm) {
          logger.info(yellow('Branch creation cancelled'));
          return;
        }

        try {
          await git.checkoutLocalBranch(prData.suggestedBranchName);
          branchToPush = prData.suggestedBranchName;
          logger.success(green(`Created and switched to branch: ${branchToPush}`));
        } catch (error) {
          logger.error(red(`Failed to create and checkout branch: ${(error as Error).message}`));
          throw new Error(`Could not create branch: ${prData.suggestedBranchName}`);
        }
      } else {
        logger.info(yellow(`Using current branch "${currentBranch}" for PR`));
      }

      // Push to remote
      logger.info(yellow(`Preparing to push branch "${branchToPush}" to remote...`));
      if (!branchToPush) {
        logger.error(red('Branch to push is undefined.'));
        return;
      }
      const pushConfirm = await confirm('Push branch to remote repository?');

      if (!pushConfirm) {
        logger.info(yellow('Remote push cancelled'));
        return;
      }

      logger.info(yellow('Pushing to remote repository...'));
      try {
        await git.push('origin', branchToPush, ['--set-upstream']);
        logger.success(green(`Pushed branch to remote`));
      } catch (error) {
        logger.error(red(`Failed to push to remote: ${(error as Error).message}`));
        throw new Error(`Could not push branch ${branchToPush} to remote`);
      }

      // Create PR using GitHub CLI if available, otherwise provide instructions
      logger.info(yellow('Creating pull request...'));
      const createGhPrConfirm = await confirm('Create GitHub PR using GitHub CLI?');

      if (createGhPrConfirm) {
        try {
          const { execa } = await import('execa');
          const upstreamTarget = upstreamBranch.replace('origin/', '');

          logger.info(yellow('Creating PR using GitHub CLI...'));
          try {
            await execa('gh', [
              'pr',
              'create',
              '--title',
              prData.prTitle,
              '--body',
              prData.prDescription,
              '--base',
              upstreamTarget
            ]);

            logger.success(green('Pull request created successfully!'));
          } catch (error) {
            // Provide manual instructions if GitHub CLI fails or is not available
            logger.warn(yellow(`Could not automatically create PR: ${(error as Error).message}`));
            logger.info(yellow('Please create it manually with:'));
            logger.info(`
Title: ${prData.prTitle}
Description:
${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
`);
          }
        } catch (error) {
          logger.warn(yellow(`Failed to import execa module: ${(error as Error).message}`));
          logger.info(yellow('Create PR manually using:'));
          logger.info(`
Title: ${prData.prTitle}
Description:
${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
`);
        }
      } else {
        logger.info(yellow('GitHub CLI PR creation skipped. Create PR manually using:'));
        logger.info(`
Title: ${prData.prTitle}
Description:
${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
`);
      }
    } else {
      logger.info(yellow('PR creation cancelled'));
    }
  } catch (e) {
    logger.error(red(`Failed to parse LLM response for PR details: ${(e as Error).message}`));
    logger.debug('Raw response:', res);
    throw new Error('Could not generate PR details');
  }
}
