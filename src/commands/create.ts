/**
 * This module implements the 'create' command, which helps users create AI-assisted
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
import { generateCompletion, LLMProvider } from '../services/llm';
import { ArgumentsCamelCase, Argv } from 'yargs';
import { PromptOptions } from 'consola';
import { config } from '../config';
import { execa } from 'execa';

export const command = 'create';
export const describe = 'Generate commit messages and create a PR using AI';
export const aliases = ['c'];

interface CreateArgv {
  yes?: boolean;
  'log-request'?: boolean;
  provider?: string;
  model?: string;
  pr?: boolean;
  draft?: boolean;
}

/**
 * Configure command line arguments for the create command
 *
 * @param yargs - Yargs instance
 * @returns Configured yargs instance with create command options
 */
export function builder(yargs: Argv): Argv<CreateArgv> {
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
    })
    .option('pr', {
      type: 'boolean',
      describe: 'Create a branch and PR',
      default: false
    })
    .option('provider', {
      type: 'string',
      describe: 'LLM provider to use (e.g., openai, ollama)',
      default: config.llmProvider
    })
    .option('model', {
      type: 'string',
      describe: 'LLM model to use (e.g., gpt-3.5-turbo, gpt-4)',
      default: config.model
    })
    .option('draft', {
      type: 'boolean',
      describe: 'Create the PR as a draft',
      default: false
    });
}

// Define global variables for confirm and logRequest
let globalConfirm: (message: string, options?: PromptOptions) => Promise<unknown>;
let globalLogRequest: boolean = false;
let model: string;
let provider: LLMProvider;

// Track whether commit messages were optimized or created during this session
let commitsOptimizedInSession = false;
let commitsCreatedInSession = false;

/**
 * Namespace and message used for git notes to track commits created by this tool
 *
 * Used to identify commits that have already been processed by PR Agent,
 * preventing duplicate processing of the same commit.
 */
const PR_AGENT_NOTE_NAMESPACE = 'pr-agent';
const PR_AGENT_NOTE_MESSAGE = 'created-by-pr-agent';

// Initialize global variables
function initializeGlobals(argv: ArgumentsCamelCase<CreateArgv>) {
  globalConfirm = async (message: string, options: PromptOptions = { type: 'confirm' }) => {
    if (argv.yes) {
      logger.info(yellow(`[Auto-confirmed] ${message}`));
      return true;
    }
    return await logger.prompt(green(message), options);
  };

  globalLogRequest = argv['log-request'] ?? false;
  provider = argv.provider as LLMProvider;
  model = argv.model!;
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
 * Checks if a branch has an open pull request
 *
 * Uses GitHub CLI to check if the current branch already has an open pull request.
 * This helps determine whether to create a new PR or update an existing one.
 *
 * @param branchName - Name of the branch to check for open PRs
 * @returns Promise resolving to PR information object if a PR exists, null otherwise
 */
async function checkForExistingPR(branchName: string): Promise<{ url: string; number: string; title: string } | null> {
  if (!branchName) {
    logger.debug('[PR-CHECK] No branch name provided to checkForExistingPR.');
    return null;
  }

  try {
    // Check if GitHub CLI is available
    const { exitCode: ghExitCode } = await execa('gh', ['--version'], { reject: false });

    if (ghExitCode !== 0) {
      logger.debug('[PR-CHECK] GitHub CLI not available for PR check');
      return null;
    }

    // Use GitHub CLI to list PRs for the current branch
    const { stdout: prJson, exitCode } = await execa(
      'gh',
      ['pr', 'list', '--head', branchName, '--state', 'open', '--json', 'url,number,title', '--limit', '1'],
      { reject: false }
    );

    if (exitCode !== 0 || !prJson) {
      logger.debug(`[PR-CHECK] No PR information available for branch ${branchName}`);
      return null;
    }

    const prs = JSON.parse(prJson);

    if (Array.isArray(prs) && prs.length > 0) {
      logger.debug(`[PR-CHECK] Found existing PR for branch ${branchName}: #${prs[0].number}`);
      return prs[0];
    }

    return null;
  } catch (error) {
    logger.debug(`[PR-CHECK] Error checking for existing PR: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Main handler for the create command - implements the workflow for creating an AI-assisted PR
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
export async function handler(argv: ArgumentsCamelCase<CreateArgv>) {
  initializeGlobals(argv);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  const baseUrl = config?.[provider]?.baseURL;
  // Log the current model, provider, and API URL
  logger.info(green('[CONFIG] Current settings:'));
  logger.info(`[CONFIG] Provider: ${provider}`);
  logger.info(`[CONFIG] Model: ${model}`);
  if (baseUrl) {
    logger.info(`[CONFIG] API URL: ${baseUrl}`);
  }

  const ready = await globalConfirm(`Are you ready to create an AI PR?`);
  //
  if (!ready) return;

  try {
    const currentDir = process.cwd();
    if (!currentDir) {
      logger.error(red('[INIT] Failed to get current working directory.'));
      return;
    }

    const git: SimpleGit = simpleGit({
      baseDir: currentDir,
      binary: 'git',
      maxConcurrentProcesses: 6
    });

    const status = await performGitOperation(() => git.status(), '[GIT] Failed to get git status');
    if (!status) return;

    logger.info(yellow('[WORKFLOW] Next step: Determine the target branch for your PR'));
    const proceedWithBranch = await globalConfirm('Would you like to proceed with determining the target branch?');
    if (!proceedWithBranch) {
      logger.info(yellow('[WORKFLOW] Process cancelled by user'));
      return;
    }

    const upstreamBranch = await performGitOperation(
      () => getUpstreamBranch(git, globalConfirm),
      '[GIT] Failed to determine upstream branch'
    );
    if (!upstreamBranch) return;

    if (!status.isClean()) {
      logger.info(yellow('[WORKFLOW] Next step: Handle uncommitted changes in your working directory'));
      const proceedWithChanges = await globalConfirm('Would you like to commit your uncommitted changes?');
      if (!proceedWithChanges) {
        logger.info(yellow('[WORKFLOW] Process cancelled by user'));
        return;
      }

      await performGitOperation(
        () => handleUncommittedChanges(git, status, globalConfirm),
        '[GIT] Failed to handle uncommitted changes'
      );
    } else {
      logger.info(green('[GIT] Working directory is clean'));
    }

    await performGitOperation(
      () => optimizeCommitMessages(git, upstreamBranch, globalConfirm),
      '[GIT] Failed to optimize commit messages'
    );

    if (!argv?.pr) {
      logger.info(yellow('[WORKFLOW] Skipping PR creation as --pr flag is not set'));
      return;
    }

    logger.info(yellow('[WORKFLOW] Final step: Create a new branch and push PR to remote'));
    const proceedWithPR = await globalConfirm('Would you like to proceed with creating a PR?');
    if (!proceedWithPR) {
      logger.info(yellow('[WORKFLOW] PR creation cancelled by user'));
      return;
    }

    await performGitOperation(
      () => createAndPushPR(git, upstreamBranch, argv?.draft, globalConfirm),
      '[GIT] Failed to create and push PR'
    );
  } catch (e) {
    logger.error(red(`[ERROR] Unexpected error occurred: ${(e as Error).message}`));
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
    logger.info(green('[BRANCH] Attempting to determine the upstream branch...'));

    // Try to get the tracking branch directly
    let branchInfo;
    try {
      branchInfo = await git.branch();
      if (!branchInfo || !branchInfo.current) {
        logger.error(red('[BRANCH] Branch information is undefined or missing current branch.'));
        throw new Error('Could not determine current branch');
      }
    } catch (error) {
      logger.error(red(`[BRANCH] Failed to get branch information: ${(error as Error).message}`));
      throw new Error('Could not determine current branch');
    }

    const trackingBranch = await git.revparse(['--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => {
      logger.info(yellow('[BRANCH] No tracking branch found'));
      return null;
    });

    if (branchInfo.current && trackingBranch) {
      logger.info(green(`[BRANCH] Found tracking branch: ${trackingBranch}`));
      const confirmTracking = await confirm(`Use "${trackingBranch}" as the target branch?`);

      if (confirmTracking) {
        return trackingBranch;
      } else {
        logger.info(yellow('[BRANCH] You chose to select a different target branch'));
      }
    }

    // If no tracking branch or user declined, get remote branches and ask user
    logger.info(yellow('[BRANCH] Fetching available remote branches...'));
    let remoteBranches;
    try {
      remoteBranches = await git.branch(['--remotes']);
      if (!remoteBranches || !remoteBranches.all) {
        logger.error(red('[BRANCH] Remote branches information is undefined.'));
        throw new Error('Could not retrieve remote branches');
      }
    } catch (error) {
      logger.error(red(`[BRANCH] Failed to fetch remote branches: ${(error as Error).message}`));
      throw new Error('Could not retrieve remote branches');
    }

    const branches = remoteBranches.all
      .filter((branch) => branch && !branch.includes('HEAD ->'))
      .map((branch) => branch.trim());

    if (!branches || branches.length === 0) {
      throw new Error('No remote branches found');
    }

    // Ask a user which branch to target - can't auto-confirm select
    const targetBranch = await logger.prompt(yellow('[BRANCH] Select target branch for PR:'), {
      type: 'select',
      options: branches
    });

    if (!targetBranch) {
      throw new Error('No branch selected');
    }

    logger.info(green(`[BRANCH] Selected target branch: ${targetBranch}`));
    const confirmSelected = await confirm(`Confirm "${targetBranch}" as your target branch?`);

    if (!confirmSelected) {
      logger.info(yellow('[BRANCH] Branch selection cancelled. Please start over.'));
      process.exit(0);
    }

    return targetBranch;
  } catch (error) {
    logger.error(red(`[BRANCH] Failed to determine upstream branch: ${(error as Error).message}`));
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
  logger.info(yellow('[COMMIT] Found uncommitted changes in the working directory'));

  const proceedWithAnalysis = await confirm('Analyze changes with AI to generate a commit message?');

  if (!proceedWithAnalysis) {
    logger.info(yellow('[COMMIT] Commit creation cancelled'));
    process.exit(0);
  }

  logger.info(yellow('[COMMIT] Collecting modified file details for analysis...'));

  // Filter out lock files and other noise from analysis
  const modifiedFiles =
    status && Array.isArray(status.modified) ? status.modified.filter((e) => e && !ignoredFiles.includes(e)) : [];

  if (!modifiedFiles || modifiedFiles.length === 0) {
    logger.info(yellow('[COMMIT] No modified files to analyze.'));
    return;
  }

  // Build a string containing all file diffs for AI analysis
  const tempModified = [] as string[];
  for (const file of modifiedFiles) {
    if (!file) continue;
    logger.info(yellow(`[COMMIT] Analyzing changes in: ${file}`));
    try {
      const stagedDiff = await git.diff(['-U3', '--minimal', '--staged', file]);
      const unstagedDiff = await git.diff(['-U3', '--minimal', file]);
      const diff = stagedDiff + unstagedDiff;
      tempModified.push(`
filename: ${file}
diff changes: ${diff}

`);
    } catch (error) {
      logger.warn(yellow(`[COMMIT] Failed to get diff for ${file}: ${(error as Error).message}`));
      // Continue with other files
    }
  }

  logger.info(yellow('[COMMIT] Generating commit message with AI...'));
  const confirmAiRequest = await confirm('Send changes to AI for commit message suggestion?');

  if (!confirmAiRequest) {
    logger.info(yellow('[COMMIT] AI message generation cancelled'));
    process.exit(0);
  }

  if (!tempModified || tempModified.length === 0) {
    logger.error(red('[COMMIT] No diffs available for AI analysis.'));
    return;
  }

  const commitPrompt = `

Provide a better multi-line commit message with summary and bullet points for all changes following the ## 1. Commit Message format in the prompt.
Format your response as a JSON object with structure:
{
  "commitMessage": "type(scope): summary of changes detailed explanation of changes...\n bullet points of changes"
}

Git diff changes are as follows:
${tempModified.join('')}

`;

  logger.info(green('[COMMIT] Sending changes to LLM for commit suggestion...'));
  const res = await generateCompletion(provider, {
    model,
    logRequest: globalLogRequest,
    prompt: commitPrompt
  });

  let commitData: { commitMessage: string };
  try {
    commitData = JSON.parse(res.text);
    if (!commitData.commitMessage) {
      logger.error(red('[COMMIT] No commit message found in LLM response'));
      logger.debug('[COMMIT] Raw response:', res);
      throw new Error('Invalid LLM response format');
    }
    logger.info(green('[COMMIT] Got commit suggestion:'));
    logger.info(`
---------------------------
Commit Message:

${commitData.commitMessage}
---------------------------
`);

    const commitConfirm = await confirm('Proceed with this commit?');

    if (commitConfirm) {
      logger.info(yellow('[COMMIT] Adding all changes to git...'));
      try {
        await git.add('.');
      } catch (error) {
        logger.error(red(`[COMMIT] Failed to add changes to git staging area: ${(error as Error).message}`));
        throw new Error('Failed to stage changes');
      }

      logger.info(yellow('[COMMIT] Creating commit with the suggested message...'));
      try {
        const commitResult = await git.commit(commitData.commitMessage);
        // Mark this commit as created by pr-agent using git notes
        if (commitResult.commit) {
          await markCommitAsCreatedByTool(git, commitResult.commit);
          // Track that we created a commit during this session
          commitsCreatedInSession = true;
        }
      } catch (error) {
        logger.error(red(`[COMMIT] Failed to create commit: ${(error as Error).message}`));
        throw new Error('Commit creation failed');
      }

      logger.success(green('[COMMIT] Changes committed successfully!'));
    } else {
      logger.info(yellow('[COMMIT] Commit cancelled'));
      process.exit(0);
    }
  } catch (e) {
    logger.debug('[COMMIT] Raw response:', res);
    logger.error(red(`[COMMIT] Failed to parse LLM response as JSON: ${(e as Error).message}`));
    process.exit(0);
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
  logger.info(yellow('[OPTIMIZE] Starting commit message optimization process...'));

  if (!upstreamBranch) {
    logger.error(red('[OPTIMIZE] Upstream branch is undefined.'));
    return;
  }

  // Get all commits between current HEAD and upstream branch
  logger.info(yellow('[OPTIMIZE] Fetching commits information...'));
  let commits;
  try {
    commits = await git.log({
      from: upstreamBranch,
      to: 'HEAD'
    });
  } catch (error) {
    logger.error(red(`[OPTIMIZE] Failed to get commit logs: ${(error as Error).message}`));
    throw new Error('Could not retrieve commit history');
  }

  if (!commits || !Array.isArray(commits.all) || !commits.all.length) {
    logger.info(yellow('[OPTIMIZE] No commits to optimize'));
    return;
  }

  logger.info(green(`[OPTIMIZE] Found ${commits.all.length} commit(s) in the branch`));
  logger.info(yellow('[OPTIMIZE] Next step: Optimize existing commit messages'));

  const proceedWithOptimize = await globalConfirm('Would you like to optimize your commit messages?');
  if (!proceedWithOptimize) {
    logger.info(yellow('[OPTIMIZE] Skipping commit message optimization'));
    return;
  }

  // Only focus on the last commit for optimization
  const lastCommit = commits?.all?.[0];
  if (!lastCommit || !lastCommit.hash) {
    logger.info(yellow('[OPTIMIZE] No commits found to optimize'));
    return;
  }

  // Check if this tool created the last commit
  const isToolCommit = await isCommitCreatedByTool(git, lastCommit.hash);
  if (isToolCommit) {
    logger.info(yellow(`[OPTIMIZE] Last commit was already created by PR Agent, skipping optimization`));
    return;
  }

  logger.info(
    yellow(`[OPTIMIZE] Will optimize the last commit: ${lastCommit.hash.substring(0, 7)} - ${lastCommit.message}`)
  );

  // Check if this is a merge commit (has multiple parents)
  let revList;
  try {
    revList = await git.raw(['rev-list', '--parents', '-n', '1', lastCommit.hash]);
    if (!revList) {
      logger.error(red('[OPTIMIZE] Failed to get parent hashes for last commit.'));
      return;
    }
  } catch (error) {
    logger.error(red(`[OPTIMIZE] Failed to check commit parents: ${(error as Error).message}`));
    throw new Error('Could not determine if commit is a merge commit');
  }

  const parentHashes = revList.trim().split(' ');

  if (!parentHashes || parentHashes.length === 0) {
    logger.error(red('[OPTIMIZE] Parent hashes are undefined or empty.'));
    return;
  }

  // If there are more than 2 entries (commit hash and parent hashes), it's a merge commit
  if (parentHashes.length > 2) {
    logger.info(yellow(`[OPTIMIZE] Cannot optimize merge commit: ${lastCommit.hash.substring(0, 7)}`));
    return;
  }

  const continueOptimization = await confirm('Continue with commit message optimization?');

  if (!continueOptimization) {
    logger.info(yellow('[OPTIMIZE] Commit message optimization cancelled'));
    return;
  }

  // Get the comprehensive diff from upstream branch to HEAD
  logger.info(yellow(`[OPTIMIZE] Getting full diff context from ${upstreamBranch} to HEAD for better analysis...`));
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
      logger.error(red('[OPTIMIZE] Full diff is not a string.'));
      return;
    }
  } catch (error) {
    logger.error(red(`[OPTIMIZE] Failed to get full branch diff: ${(error as Error).message}`));
    throw new Error('Could not retrieve branch diff for analysis');
  }

  // Get the individual commit diff as well
  logger.info(yellow(`[OPTIMIZE] Also analyzing the specific commit: ${lastCommit.hash.substring(0, 7)}`));
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
      logger.warn(yellow('[OPTIMIZE] Commit diff is not a string.'));
      commitDiff = 'Failed to retrieve specific commit diff';
    }
  } catch (error) {
    logger.error(red(`[OPTIMIZE] Failed to get commit diff: ${(error as Error).message}`));
    logger.info(yellow('[OPTIMIZE] Will continue with just the full branch diff for analysis'));
    commitDiff = 'Failed to retrieve specific commit diff';
  }

  const promptMsg = `

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

Current commit message: "${lastCommit.message}"

Specific commit diff:
${commitDiff}

Full branch context (all changes from upstream to HEAD):
${fullDiff}
`;

  logger.info(yellow(`[OPTIMIZE] Requesting commit message analysis from AI with comprehensive context...`));
  const res = await generateCompletion(provider, {
    model,
    logRequest: globalLogRequest,
    prompt: promptMsg
  });

  try {
    const analysis = JSON.parse(res.text);

    if (!analysis || typeof analysis !== 'object') {
      logger.error(red('[OPTIMIZE] AI analysis response is not an object.'));
      throw new Error('Invalid AI analysis response');
    }

    if (analysis.needsImprovement) {
      logger.info(green(`[OPTIMIZE] AI suggests improving the last commit message`));
      logger.info(`
---------------------------
Commit message analysis:

Current commit message: ${lastCommit.message}
Improved commit message: ${analysis.improvedCommitMessage}
Reason for improvement: ${analysis.reason}
---------------------------
`);
      const amendConfirm = await confirm(`Amend commit ${lastCommit.hash.substring(0, 7)} with the improved message?`);

      if (amendConfirm) {
        logger.info(green(`[OPTIMIZE] Amending last commit ${lastCommit.hash.substring(0, 7)}...`));

        // Amend the last commit with the new message
        try {
          await git.raw(['commit', '--amend', '-m', analysis.improvedCommitMessage]);

          // Mark the amended commit as created by our tool
          await markCommitAsCreatedByTool(git, 'HEAD');

          // Set the global flag to indicate a commit was optimized in this session
          commitsOptimizedInSession = true;

          logger.success(green(`[OPTIMIZE] Last commit amended successfully`));
        } catch (error) {
          logger.error(red(`[OPTIMIZE] Failed to amend commit: ${(error as Error).message}`));
          throw new Error('Could not amend commit message');
        }
      } else {
        logger.info(yellow(`[OPTIMIZE] Skipping amendment for last commit`));
      }
    } else {
      await markCommitAsCreatedByTool(git, lastCommit.hash);
      commitsOptimizedInSession = true;
      logger.info(yellow(`[OPTIMIZE] No changes needed for last commit: ${analysis.reason}`));
    }
  } catch (e) {
    logger.error(red(`[OPTIMIZE] Failed to optimize last commit: ${(e as Error).message}`));
    logger.debug('[OPTIMIZE] Raw response:', res);
    throw new Error('Commit message optimization failed');
  }

  // Log the updated commit message
  try {
    const updatedCommit = await git.log(['-1']);
    if (updatedCommit && updatedCommit.latest) {
      logger.info(green('[OPTIMIZE] Last commit after optimization:'));
      logger.info(`${updatedCommit.latest?.hash?.substring(0, 7) ?? ''} - ${updatedCommit.latest?.message ?? ''}`);
    } else {
      logger.warn(yellow('[OPTIMIZE] Updated commit information is undefined.'));
    }
  } catch (error) {
    logger.warn(yellow(`[OPTIMIZE] Failed to retrieve updated commit: ${(error as Error).message}`));
    // Not a critical error, so we don't throw
  }

  logger.success(green('[OPTIMIZE] Commit message optimization complete'));
}

/**
 * Creates and pushes a pull request with AI-generated details
 *
 * This function:
 * 1. Checks if the current branch already has an open PR
 * 2. If an open PR exists, updates it with new commits and optionally updates the PR description
 * 3. If no open PR exists, generates a new branch name, PR title, and description using AI
 * 4. Pushes the branch to the remote repository
 * 5. Creates a new PR using the GitHub CLI or provides manual instructions if the CLI is unavailable
 *
 * @param git - SimpleGit instance for git operations
 * @param upstreamBranch - Name of the upstream branch to compare against
 * @param draft - Whether to create the PR as a draft
 * @param confirm - Function to handle confirmations (respects --yes flag)
 * @returns Promise that resolves when the PR is created or updated
 */
async function createAndPushPR(
  git: SimpleGit,
  upstreamBranch: string,
  draft: boolean | undefined,
  confirm: (message: string, options?: PromptOptions) => Promise<unknown>
) {
  logger.info(green('[PR-CREATE] Preparing to create or update a PR'));

  if (!upstreamBranch) {
    logger.error(red('[PR-CREATE] Upstream branch is undefined.'));
    return;
  }

  // Get the latest commit to use for branch name suggestion and PR details
  logger.info(yellow('[PR-CREATE] Fetching latest commit for PR details...'));
  let latestCommit;
  try {
    latestCommit = await git.log(['-1']);
    if (!latestCommit || !latestCommit.latest) {
      logger.error(red('[PR-CREATE] Latest commit information is undefined.'));
      throw new Error('Could not retrieve latest commit information');
    }
  } catch (error) {
    logger.error(red(`[PR-CREATE] Failed to get latest commit: ${(error as Error).message}`));
    throw new Error('Could not retrieve latest commit information');
  }

  const commitMessage = latestCommit.latest?.message || '';

  // Get current branch
  let branchSummary;
  try {
    branchSummary = await git.branch();
    if (!branchSummary || !branchSummary.current) {
      logger.error(red('[PR-CREATE] Branch summary or current branch is undefined.'));
      throw new Error('Could not determine current branch');
    }
  } catch (error) {
    logger.error(red(`[PR-CREATE] Failed to get current branch information: ${(error as Error).message}`));
    throw new Error('Could not determine current branch');
  }

  const currentBranch = branchSummary.current;

  // Check if the current branch already has an open PR
  logger.info(yellow('[PR-CREATE] Checking if the current branch already has an open PR...'));
  const existingPR = await checkForExistingPR(currentBranch);

  if (existingPR) {
    logger.info(green(`[PR-CREATE] Found existing PR #${existingPR.number} for branch "${currentBranch}"`));
    logger.info(yellow('[PR-CREATE] Title: ') + existingPR.title);
    logger.info(yellow('[PR-CREATE] URL: ') + existingPR.url);

    const updateExistingPR = await confirm('Do you want to update this existing PR?');

    if (updateExistingPR) {
      // Push new commits to the existing branch
      logger.info(yellow(`[PR-CREATE] Pushing to branch "${currentBranch}" to update PR #${existingPR.number}...`));
      try {
        await git.push('origin', currentBranch);
        logger.success(green(`[PR-CREATE] Successfully pushed updates to PR #${existingPR.number}`));
        logger.info(green(`[PR-CREATE] PR URL: ${existingPR.url}`));

        // Check if there are new commits to determine if we should prompt for PR description update
        // Note: This will include the commit(s) we just pushed
        let hasNewCommits = false;
        try {
          const prBranchCommits = await git.log({
            from: upstreamBranch,
            to: 'HEAD'
          });

          hasNewCommits = prBranchCommits && Array.isArray(prBranchCommits.all) && prBranchCommits.all.length > 0;

          if (hasNewCommits) {
            // This count includes the commit we just pushed
            logger.info(
              green(`[PR-CREATE] Found ${prBranchCommits.all.length} commit(s) in the PR, including your recent push`)
            );

            // Log the commits for clarity
            if (prBranchCommits.all.length > 0) {
              logger.info(yellow('[PR-CREATE] Commits in this PR:'));
              prBranchCommits.all.forEach((commit) => {
                logger.info(`  ${commit.hash.substring(0, 7)}: ${commit.message.split('\n')[0]}`);
              });
            }
          } else {
            logger.info(yellow('[PR-CREATE] No commits found to include in PR description update.'));
          }
        } catch (error) {
          logger.warn(yellow(`[PR-CREATE] Failed to check for new commits: ${(error as Error).message}`));
          // Default to prompting for update if we can't determine - safer to ask than to skip
          hasNewCommits = true;
          logger.info(yellow('[PR-CREATE] Unable to verify commits, will prompt for PR description update.'));
        }

        // Also consider if any commits were optimized or created during this session
        if (commitsOptimizedInSession) {
          logger.info(green('[PR-CREATE] Commits were optimized during this session.'));
          hasNewCommits = true;
        }

        if (commitsCreatedInSession) {
          logger.info(green('[PR-CREATE] New commits were created during this session.'));
          hasNewCommits = true;
        }

        // Only prompt for PR description update if there are new commits or if commits were created/optimized
        if (hasNewCommits) {
          // Ask if user wants to update the PR description with new changes
          const updatePrDescription = await confirm(
            'Would you like to update the PR description with the new changes?'
          );

          if (updatePrDescription) {
            logger.info(yellow('[PR-CREATE] Generating updated PR title and description...'));

            // Get the current PR title and description
            let currentTitle = existingPR.title || '';
            let currentDescription = '';
            try {
              const { stdout: prDetails } = await execa(
                'gh',
                [
                  'pr',
                  'view',
                  existingPR.number.toString(),
                  '--json',
                  'title,body',
                  '--jq',
                  '{title: .title, body: .body}'
                ],
                { reject: false }
              );

              const prDetailsObj = JSON.parse(prDetails.trim());
              currentTitle = prDetailsObj.title || '';
              currentDescription = prDetailsObj.body || '';
              logger.debug(`[PR-CREATE] Retrieved current PR title: "${currentTitle}"`);
              logger.debug(`[PR-CREATE] Retrieved current PR description (${currentDescription.length} chars)`);
            } catch (error) {
              logger.warn(yellow(`[PR-CREATE] Failed to get current PR details: ${(error as Error).message}`));
              logger.info(yellow('[PR-CREATE] Will generate new content without the previous title/description'));
            }

            // Get new commits since the PR was created
            let newCommits = '';
            try {
              const prBranchCommits = await git.log({
                from: upstreamBranch,
                to: 'HEAD'
              });

              if (prBranchCommits && Array.isArray(prBranchCommits.all) && prBranchCommits.all.length > 0) {
                newCommits = prBranchCommits.all
                  .map((commit) => `- ${commit.hash.substring(0, 7)}: ${commit.message.split('\n')[0]}`)
                  .join('\n');
              }
            } catch (error) {
              logger.warn(yellow(`[PR-CREATE] Failed to get new commits: ${(error as Error).message}`));
            }

            // Get the diff for new changes
            let recentChanges = '';
            try {
              // Get the latest commit hash
              const latestCommit = await git.revparse(['HEAD']);
              // Get the diff of the latest commit
              recentChanges = await git.show([
                '-U3',
                '--minimal',
                latestCommit,
                ...ignoredFiles.map((file) => `:(exclude)${file}`),
                ':(exclude)*.generated.*',
                ':(exclude)*.lock'
              ]);
            } catch (error) {
              logger.warn(yellow(`[PR-CREATE] Failed to get recent changes: ${(error as Error).message}`));
            }

            // Generate an updated PR title and description using AI
            const updateDescriptionPrompt = `
Generate an updated pull request title and description that incorporates both the original content and new changes.

Format your response as a JSON object with the following structure:
{
  "updatedTitle": "The updated PR title",
  "updatedDescription": "The complete updated PR description with original content preserved when appropriate and new changes clearly highlighted"
}

Current PR title:
${currentTitle || 'No current title available'}

Current PR description:
${currentDescription || 'No current description available'}

New commits added to the PR:
${newCommits || 'No new commit information available'}

Recent changes:
${recentChanges || 'No recent changes information available'}

Please create a comprehensive title and description that:
1. Preserves relevant information from the original title and description
2. Clearly highlights the new changes under a "## Recent Updates" section
3. Ensures the title and description are well-formatted with proper markdown
4. Keeps the total length reasonable (under 4000 characters)
`;

            const updateRes = await generateCompletion(provider, {
              model,
              logRequest: globalLogRequest,
              prompt: updateDescriptionPrompt
            });

            let updatedDescriptionData;
            try {
              updatedDescriptionData = JSON.parse(updateRes.text);

              if (!updatedDescriptionData?.updatedTitle || !updatedDescriptionData?.updatedDescription) {
                logger.error(red('[PR-CREATE] Updated title or description missing from AI response'));
                throw new Error('Invalid AI response format for PR update');
              }

              logger.info(green('[PR-CREATE] Generated updated PR title and description'));
              logger.info(`
---------------------------
Updated PR Title:
${updatedDescriptionData.updatedTitle}

Updated PR Description:
${updatedDescriptionData.updatedDescription.substring(0, 200)}... (truncated)
---------------------------
`);

              // Ask the user if they want to apply the updated title and description
              const confirmDescription = await confirm('Apply the updated PR title and description?');

              if (confirmDescription) {
                try {
                  await execa('gh', [
                    'pr',
                    'edit',
                    existingPR.number.toString(),
                    '--title',
                    updatedDescriptionData.updatedTitle,
                    '--body',
                    updatedDescriptionData.updatedDescription
                  ]);

                  logger.success(green('[PR-CREATE] Successfully updated PR title and description'));
                } catch (error) {
                  logger.error(
                    red(`[PR-CREATE] Failed to update PR title and description: ${(error as Error).message}`)
                  );
                  logger.info(
                    yellow('[PR-CREATE] You can manually update the PR with this title and description if needed')
                  );
                }
              } else {
                logger.info(yellow('[PR-CREATE] PR title and description update skipped'));
              }
            } catch (e) {
              logger.error(
                red(
                  `[PR-CREATE] Failed to parse AI response for updated PR title and description: ${(e as Error).message}`
                )
              );
              logger.debug('[PR-CREATE] Raw response:', updateRes);
            }
          }
        }

        return;
      } catch (error) {
        logger.error(red(`[PR-CREATE] Failed to push to remote: ${(error as Error).message}`));
        throw new Error(`Could not push branch ${currentBranch} to remote`);
      }
    } else {
      logger.info(yellow('[PR-CREATE] Update cancelled. Will create a new branch and PR instead.'));
    }
  }

  const generatePrDetails = await confirm('Generate PR details with AI based on your commits?');

  if (!generatePrDetails) {
    logger.info(yellow('[PR-CREATE] PR creation cancelled'));
    return;
  }

  // Generate PR details using LLM
  logger.info(yellow('[PR-CREATE] Requesting PR suggestions from AI...'));
  // get existing branch names to exclude them from suggestions
  let existingBranches;
  try {
    existingBranches = await git.branchLocal();
    if (!existingBranches || !Array.isArray(existingBranches.all)) {
      logger.warn(yellow('[PR-CREATE] Local branches information is undefined.'));
      existingBranches = { all: [] };
    }
  } catch (error) {
    logger.warn(yellow(`[PR-CREATE] Failed to get local branches: ${(error as Error).message}`));
    existingBranches = { all: [] };
  }

  const existingBranchNames = Array.isArray(existingBranches.all)
    ? existingBranches.all.map((branch) => branch?.trim()).join(', ')
    : '';

  let fullDiff = '';
  try {
    fullDiff = await git.diff([upstreamBranch, 'HEAD']);
  } catch (error) {
    logger.warn(yellow(`[PR-CREATE] Failed to get full diff for PR suggestion: ${(error as Error).message}`));
  }

  const prPrompt = `

Exclude the following branches from suggestions: ${existingBranchNames}

Format your response as a JSON object with the following length and structure:
- suggestedBranchName: max 50 characters alphanumeric, lowercase, and hyphenated.
- prTitle: max 100 characters and follow the format prompt ## 2. Pull Request Title.
- prDescription: max 2000 characters and follow the format prompt ## 3. Pull Request Description.

Follow the structure:
{
  "suggestedBranchName": "feature/descriptive-name",
  "prTitle": "type(scope): PR Title",
  "prDescription": "## Summary\\n[Comprehensive description of the changes]"
}

Based on this commit message, suggest a branch name, PR title and description for a pull request:


Commit message: ${commitMessage}

Full diff from ${upstreamBranch} to HEAD:
${fullDiff}
`;

  const res = await generateCompletion(provider, {
    model,
    logRequest: globalLogRequest,
    prompt: prPrompt
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
      logger.error(red('[PR-CREATE] AI PR data is missing required fields.'));
      throw new Error('Invalid PR data from AI');
    }

    // Show PR details and confirm
    logger.info(`
---------------------------
Pull Request Details:

Title: ${prData.prTitle}
Description: ${prData.prDescription}
Branch name: ${prData.suggestedBranchName}
---------------------------
`);
    const createPRConfirm = await confirm('Create PR with these details?');

    if (createPRConfirm) {
      let branchToPush = currentBranch;
      const targetBranchName = upstreamBranch.replace('origin/', '');

      // Only create a new branch if the current branch is the target branch and no existing PR
      if (currentBranch === targetBranchName && !existingPR) {
        // Create a new branch
        logger.info(
          yellow(
            `[PR-CREATE] Current branch is the same as target branch. Creating new branch: ${prData.suggestedBranchName}...`
          )
        );
        if (!prData.suggestedBranchName) {
          logger.error(red('[PR-CREATE] Suggested branch name is undefined.'));
          return;
        }
        const createBranchConfirm = await confirm(`Confirm creation of branch "${prData.suggestedBranchName}"?`);

        if (!createBranchConfirm) {
          logger.info(yellow('[PR-CREATE] Branch creation cancelled'));
          return;
        }

        try {
          await git.checkoutLocalBranch(prData.suggestedBranchName);
          branchToPush = prData.suggestedBranchName;
          logger.success(green(`[PR-CREATE] Created and switched to branch: ${branchToPush}`));
        } catch (error) {
          logger.error(red(`[PR-CREATE] Failed to create and checkout branch: ${(error as Error).message}`));
          throw new Error(`Could not create branch: ${prData.suggestedBranchName}`);
        }
      } else {
        if (existingPR) {
          logger.info(
            yellow(`[PR-CREATE] Using current branch "${currentBranch}" to update existing PR #${existingPR.number}`)
          );
        } else {
          logger.info(yellow(`[PR-CREATE] Using current branch "${currentBranch}" for PR`));
        }
      }

      // Push to remote
      logger.info(yellow(`[PR-CREATE] Preparing to push branch "${branchToPush}" to remote...`));
      if (!branchToPush) {
        logger.error(red('[PR-CREATE] Branch to push is undefined.'));
        return;
      }
      const pushConfirm = await confirm(`Push branch "${branchToPush}" to remote repository?`);

      if (!pushConfirm) {
        logger.info(yellow('[PR-CREATE] Remote push cancelled'));
        return;
      }

      logger.info(yellow(`[PR-CREATE] Pushing to remote repository...`));
      try {
        if (existingPR) {
          // Simple push for existing PR
          await git.push('origin', branchToPush);
          logger.success(green(`[PR-CREATE] Updated existing PR #${existingPR.number}`));
          logger.info(green(`[PR-CREATE] PR URL: ${existingPR.url}`));
        } else {
          // Set upstream for new branches
          await git.push('origin', branchToPush, ['--set-upstream']);
          logger.success(green(`[PR-CREATE] Pushed branch to remote`));
        }
      } catch (error) {
        logger.error(red(`[PR-CREATE] Failed to push to remote: ${(error as Error).message}`));
        throw new Error(`Could not push branch ${branchToPush} to remote`);
      }

      // Only create a new PR if one doesn't already exist
      if (!existingPR) {
        // Check GitHub CLI availability and configuration before offering to create PR
        logger.info(yellow('[PR-CREATE] Checking GitHub CLI availability...'));
        let isGitHubCliAvailable = false;
        let isGitHubCliConfigured = false;

        try {
          // Check if 'gh' command is available
          const { exitCode: ghExitCode } = await execa('gh', ['--version'], { reject: false });
          isGitHubCliAvailable = ghExitCode === 0;

          if (isGitHubCliAvailable) {
            // Check if GitHub CLI is authenticated
            const { stdout: authStatus, exitCode: authExitCode } = await execa('gh', ['auth', 'status'], {
              reject: false
            });
            isGitHubCliConfigured = authExitCode === 0 && authStatus.includes('Logged in to');

            if (!isGitHubCliConfigured) {
              logger.warn(yellow('[PR-CREATE] GitHub CLI is installed but not properly configured.'));
              logger.info(`
To authenticate GitHub CLI, run the following command:
$ gh auth login

For more information, visit: https://cli.github.com/manual/gh_auth_login
              `);
            }
          } else {
            logger.warn(yellow('[PR-CREATE] GitHub CLI is not installed on your system.'));
            logger.info(`
To install GitHub CLI:
- macOS: brew install gh
- Windows: winget install --id GitHub.cli
- Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md

For more information, visit: https://cli.github.com/manual/installation
            `);
          }
        } catch (error) {
          logger.warn(yellow(`[PR-CREATE] Failed to check GitHub CLI: ${(error as Error).message}`));
          isGitHubCliAvailable = false;
          isGitHubCliConfigured = false;
        }

        // Create PR using GitHub CLI if available, otherwise provide instructions
        logger.info(yellow('[PR-CREATE] Creating pull request...'));
        const createGhPrConfirm = await confirm('Create GitHub PR using GitHub CLI?');

        if (createGhPrConfirm) {
          if (!isGitHubCliAvailable || !isGitHubCliConfigured) {
            logger.warn(yellow('[PR-CREATE] GitHub CLI is not available or not properly configured.'));
            logger.info(yellow('[PR-CREATE] Create PR manually using:'));
            logger.info(`
Title: ${prData.prTitle}
Description: ${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
            `);
            return;
          }

          try {
            const upstreamTarget = upstreamBranch.replace('origin/', '');
            logger.info(yellow('[PR-CREATE] Creating PR using GitHub CLI...'));
            try {
              // Add draft flag if argv.draft is true
              const draftFlag = draft === true ? ['--draft'] : [];
              const { stdout } = await execa('gh', [
                'pr',
                'create',
                '--title',
                prData.prTitle,
                '--body',
                prData.prDescription,
                '--base',
                upstreamTarget,
                ...draftFlag
              ]);

              // Extract PR URL from output or get it using gh pr view
              let prUrl = stdout.trim();
              if (!prUrl.includes('http')) {
                const { stdout: viewOutput } = await execa('gh', ['pr', 'view', '--json', 'url', '--jq', '.url']);
                prUrl = viewOutput.trim();
              }

              logger.success(green('[PR-CREATE] Pull request created successfully!'));
              logger.info(green(`[PR-CREATE] PR URL: ${prUrl}`));
            } catch (error) {
              // Provide manual instructions if GitHub CLI fails or is not available
              logger.warn(yellow(`[PR-CREATE] Could not automatically create PR: ${(error as Error).message}`));
              logger.info(yellow('[PR-CREATE] Please create it manually with:'));
              logger.info(`
Title: ${prData.prTitle}
Description: ${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
`);
            }
          } catch (error) {
            logger.warn(yellow(`[PR-CREATE] Failed to import execa module: ${(error as Error).message}`));
            logger.info(yellow('[PR-CREATE] Create PR manually using:'));
            logger.info(`
Title: ${prData.prTitle}
Description: ${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
`);
          }
        } else {
          logger.info(yellow('[PR-CREATE] GitHub CLI PR creation skipped. Create PR manually using:'));
          logger.info(`
Title: ${prData.prTitle}
Description: ${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
`);
        }
      }
    } else {
      logger.info(yellow('[PR-CREATE] PR creation cancelled'));
    }
  } catch (e) {
    logger.error(red(`[PR-CREATE] Failed to parse LLM response for PR details: ${(e as Error).message}`));
    logger.debug('[PR-CREATE] Raw response:', res);
    throw new Error('Could not generate PR details');
  }
}
