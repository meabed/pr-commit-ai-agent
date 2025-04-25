/**
 * Push Command Module
 *
 * This module implements the 'push' command which helps users create AI-assisted
 * pull requests. It provides functionality for optimizing commit messages,
 * creating branch names, generating PR titles and descriptions using AI.
 *
 * The workflow includes:
 * 1. Determining target branch
 * 2. Handling uncommitted changes
 * 3. Optimizing existing commit messages
 * 4. Creating and pushing a PR with AI-generated content
 */
import * as process from 'node:process'
import { logger } from '../logger'
import { green, red, yellow } from 'picocolors'
import { simpleGit, SimpleGit, StatusResult } from 'simple-git'
import { generateCompletion } from '../services/llm'

export const command = 'push'
export const describe = 'Create PR and push to remote'
export const aliases = ['c']

/**
 * Main handler for the push command - implements the workflow for creating an AI-assisted PR
 */
export async function handler() {
  const ready = await logger.prompt(green(`Are you ready to create an AI PR?`), {
    type: 'confirm',
  })
  if (ready) {
    try {
      const currentDir = process.cwd()
      const git: SimpleGit = simpleGit({
        baseDir: currentDir,
        binary: 'git',
        maxConcurrentProcesses: 6,
      })
      const status = await git.status()

      // Get upstream branch tracking
      logger.info(yellow('Next step: Determine the target branch for your PR'))
      const proceedWithBranch = await logger.prompt(
        green('Would you like to proceed with determining the target branch?'),
        {
          type: 'confirm',
        },
      )
      if (!proceedWithBranch) {
        logger.info(yellow('Process cancelled by user'))
        return
      }
      const upstreamBranch = await getUpstreamBranch(git)

      // Handle uncommitted changes
      if (!status.isClean()) {
        logger.info(yellow('Next step: Handle uncommitted changes in your working directory'))
        const proceedWithChanges = await logger.prompt(green('Would you like to commit your uncommitted changes?'), {
          type: 'confirm',
        })
        if (!proceedWithChanges) {
          logger.info(yellow('Process cancelled by user'))
          return
        }
        await handleUncommittedChanges(git, status)
      } else {
        logger.info(green('Working directory is clean'))
      }

      // Get all commits and optimize them
      logger.info(yellow('Next step: Optimize existing commit messages'))
      const proceedWithOptimize = await logger.prompt(green('Would you like to optimize your commit messages?'), {
        type: 'confirm',
      })
      if (!proceedWithOptimize) {
        logger.info(yellow('Skipping commit message optimization'))
      } else {
        await optimizeCommitMessages(git, upstreamBranch)
      }

      // Create and push a new branch and PR
      logger.info(yellow('Final step: Create a new branch and push PR to remote'))
      const proceedWithPR = await logger.prompt(green('Would you like to proceed with creating a PR?'), {
        type: 'confirm',
      })
      if (!proceedWithPR) {
        logger.info(yellow('PR creation cancelled by user'))
        return
      }
      await createAndPushPR(git, upstreamBranch)
    } catch (e) {
      logger.error(red((e as Error).message))
    }
  }
}

// Files to exclude from diff analysis to reduce noise and focus on meaningful code changes
const ignoredFiles = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'tsconfig.json']

// Namespace and message used for git notes to track commits created by this tool
const PR_AGENT_NOTE_NAMESPACE = 'pr-agent'
const PR_AGENT_NOTE_MESSAGE = 'created-by-pr-agent'

/**
 * Determines the upstream branch to use as the target for PR creation
 *
 * First tries to detect the current tracking branch, and if none exists or user declines,
 * presents a list of available remote branches to choose from.
 *
 * @param git - SimpleGit instance
 * @returns Promise resolving to the selected upstream branch name
 */
async function getUpstreamBranch(git: SimpleGit): Promise<string> {
  try {
    logger.info(green('Attempting to determine the upstream branch...'))

    // Try to get the tracking branch directly
    const branchInfo = await git.branch()
    const trackingBranch = await git.revparse(['--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => {
      logger.info(yellow('No tracking branch found'))
      return null
    })

    if (branchInfo.current && trackingBranch) {
      logger.info(green(`Found tracking branch: ${trackingBranch}`))
      const confirmTracking = await logger.prompt(green(`Use "${trackingBranch}" as the target branch?`), {
        type: 'confirm',
      })

      if (confirmTracking) {
        return trackingBranch
      } else {
        logger.info(yellow('You chose to select a different target branch'))
      }
    }

    // If no tracking branch or user declined, get remote branches and ask user
    logger.info(yellow('Fetching available remote branches...'))
    const remoteBranches = await git.branch(['--remotes'])
    const branches = remoteBranches.all.filter((branch) => !branch.includes('HEAD ->')).map((branch) => branch.trim())

    if (branches.length === 0) {
      throw new Error('No remote branches found')
    }

    // Ask a user which branch to target
    const targetBranch = await logger.prompt(yellow('Select target branch for PR:'), {
      type: 'select',
      options: branches,
    })

    logger.info(green(`Selected target branch: ${targetBranch}`))
    const confirmSelected = await logger.prompt(green(`Confirm "${targetBranch}" as your target branch?`), {
      type: 'confirm',
    })

    if (!confirmSelected) {
      logger.info(yellow('Branch selection cancelled. Please start over.'))
      process.exit(0)
    }

    return targetBranch
  } catch (error) {
    logger.error(red(`Failed to determine upstream branch: ${(error as Error).message}`))
    throw error
  }
}

/**
 * Handles uncommitted changes in the working directory
 *
 * Uses AI to analyze file changes and generate an appropriate commit message,
 * then commits the changes with that message.
 *
 * @param git - SimpleGit instance
 * @param status - Current git status
 * @returns Promise resolving to commit data
 */
async function handleUncommittedChanges(git: SimpleGit, status: StatusResult) {
  logger.info(yellow('Found uncommitted changes in the working directory'))

  const proceedWithAnalysis = await logger.prompt(green('Analyze changes with AI to generate a commit message?'), {
    type: 'confirm',
  })

  if (!proceedWithAnalysis) {
    logger.info(yellow('Commit creation cancelled'))
    process.exit(0)
  }

  logger.info(yellow('Collecting modified file details for analysis...'))

  // Filter out lock files and other noise from analysis
  const modifiedFiles =
    status.modified?.filter((e) => {
      return !ignoredFiles.includes(e)
    }) || []

  // Build a string containing all file diffs for AI analysis
  const tempModified = [] as string[]
  for (const file of modifiedFiles) {
    logger.info(yellow(`Analyzing changes in: ${file}`))
    const diff = await git.diff(['--cached', file])
    tempModified.push(`
filename: ${file}
diff changes: ${diff}
____________=========================____________
`)
  }

  logger.info(yellow('Generating commit message with AI...'))
  const confirmAiRequest = await logger.prompt(green('Send changes to AI for commit message suggestion?'), {
    type: 'confirm',
  })

  if (!confirmAiRequest) {
    logger.info(yellow('AI message generation cancelled'))
    process.exit(0)
  }

  // Prompt for AI to generate a good commit message following conventions
  const systemPrompt = `
  You are a senior software architect and code review expert with extensive experience in version control best practices. Analyze the provided git diff and generate the following high-quality outputs:

    Provide a better commit message that clearly describes the change using the conventional commit format 
(type(scope): description). Types include: feat, fix, docs, style, refactor, perf, test, build, ci, chore.
The message should be concise, clear, and follow best practices.

Format your response as a JSON object with the following length and structure:
- commitMessage: max 120 characters
and the following structure:
{
  "commitMessage": "type(scope): summary of changes detailed explanation of changes..."
}
`

  logger.info(green('Sending changes to LLM for commit suggestion...'))
  const res = await generateCompletion('ollama', {
    prompt: `${systemPrompt}${tempModified.join('')}`,
  })

  let commitData: { commitMessage: string }
  try {
    commitData = JSON.parse(res.text)
    if (!commitData.commitMessage) {
      logger.error(red('No commit message found in LLM response'))
      logger.debug('Raw response:', res)
      throw new Error('Invalid LLM response format')
    }
    logger.info(green('Got commit suggestion:'))
    logger.box({
      title: 'Commit Message',
      content: commitData.commitMessage,
    })

    const commitConfirm = await logger.prompt(green('Proceed with this commit?'), {
      type: 'confirm',
    })

    if (commitConfirm) {
      logger.info(yellow('Adding all changes to git...'))
      await git.add('.')

      logger.info(yellow('Creating commit with the suggested message...'))
      try {
        const commitResult = await git.commit(commitData.commitMessage)
        // Mark this commit as created by pr-agent using git notes
        if (commitResult.commit) {
          await markCommitAsCreatedByTool(git, commitResult.commit)
        }
      } catch (error) {
        logger.error(red('Failed to create commit'))
        logger.debug('Error details:', error)
        throw new Error('Commit creation failed')
      }

      logger.success(green('Changes committed successfully!'))
    } else {
      logger.info(yellow('Commit cancelled'))
      process.exit(0)
    }
  } catch (e) {
    logger.debug('Raw response:', res)
    logger.error(red('Failed to parse LLM response as JSON'))
    throw new Error('Invalid LLM response format')
  }

  return commitData
}

/**
 * Marks a commit as created by the PR Agent tool using git notes
 *
 * This allows the tool to identify its own commits in later operations
 *
 * @param git - SimpleGit instance
 * @param commitHash - Hash of the commit to mark
 */
async function markCommitAsCreatedByTool(git: SimpleGit, commitHash: string) {
  try {
    logger.debug(`Marking commit ${commitHash} as created by PR Agent`)
    await git.raw(['notes', '--ref', PR_AGENT_NOTE_NAMESPACE, 'add', '-m', PR_AGENT_NOTE_MESSAGE, commitHash])
    logger.debug(`Successfully marked commit ${commitHash}`)
  } catch (error) {
    // Don't fail the whole process if we can't add notes
    logger.debug(`Failed to mark commit with git notes: ${(error as Error).message}`)
  }
}

/**
 * Checks if a commit was created by the PR Agent tool
 *
 * Reads git notes to determine if a commit was previously created by this tool
 *
 * @param git - SimpleGit instance
 * @param commitHash - Hash of the commit to check
 * @returns Promise resolving to boolean indicating if tool created commit
 */
async function isCommitCreatedByTool(git: SimpleGit, commitHash: string): Promise<boolean> {
  try {
    const notes = await git.raw(['notes', '--ref', PR_AGENT_NOTE_NAMESPACE, 'show', commitHash]).catch(() => '')
    return notes.includes(PR_AGENT_NOTE_MESSAGE)
  } catch (error) {
    logger.debug(`Failed to check git notes: ${(error as Error).message}`)
    return false
  }
}

/**
 * Optimizes commit messages for the last commit while using the full diff context
 * from upstream branch to HEAD for better analysis.
 *
 * Uses AI to analyze the comprehensive changes and suggest a better commit message
 * that follows a conventional commit format. Only amends the last commit.
 *
 * @param git - SimpleGit instance
 * @param upstreamBranch - Name of the upstream branch
 */
async function optimizeCommitMessages(git: SimpleGit, upstreamBranch: string) {
  logger.info(yellow('Starting commit message optimization process...'))

  // Get all commits between current HEAD and upstream branch
  logger.info(yellow('Fetching commits information...'))
  const commits = await git.log({
    from: upstreamBranch,
    to: 'HEAD',
  })

  if (!commits.all.length) {
    logger.info(yellow('No commits to optimize'))
    return
  }

  logger.info(green(`Found ${commits.all.length} commit(s) in the branch`))

  // Only focus on the last commit for optimization
  const lastCommit = commits?.all?.[0]
  if (!lastCommit) {
    logger.info(yellow('No commits found to optimize'))
    return
  }

  // Check if the last commit was created by this tool
  const isToolCommit = await isCommitCreatedByTool(git, lastCommit.hash)
  if (isToolCommit) {
    logger.info(yellow(`Last commit was already created by PR Agent, skipping optimization`))
    return
  }

  logger.info(yellow(`Will optimize the last commit: ${lastCommit.hash.substring(0, 7)} - ${lastCommit.message}`))

  // Check if this is a merge commit (has multiple parents)
  const revList = await git.raw(['rev-list', '--parents', '-n', '1', lastCommit.hash])
  const parentHashes = revList.trim().split(' ')

  // If there are more than 2 entries (commit hash + parent hashes), it's a merge commit
  if (parentHashes.length > 2) {
    logger.info(yellow(`Cannot optimize merge commit: ${lastCommit.hash.substring(0, 7)}`))
    return
  }

  const continueOptimization = await logger.prompt(green('Continue with commit message optimization?'), {
    type: 'confirm',
  })

  if (!continueOptimization) {
    logger.info(yellow('Commit message optimization cancelled'))
    return
  }

  // Get the comprehensive diff from upstream branch to HEAD
  logger.info(yellow(`Getting full diff context from ${upstreamBranch} to HEAD for better analysis...`))
  const fullDiff = await git.diff([
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
    ':(exclude)*.jpeg',
  ])

  // Get the individual commit diff as well
  logger.info(yellow(`Also analyzing the specific commit: ${lastCommit.hash.substring(0, 7)}`))
  const commitDiff = await git.show([
    lastCommit.hash,
    ...ignoredFiles.map((file) => `:(exclude)${file}`),
    ':(exclude)*.generated.*',
    ':(exclude)*.lock',
    ':(exclude)tsconfig.json',
    ':(exclude)tsconfig.*.json',
    ':(exclude)*.svg',
    ':(exclude)*.png',
    ':(exclude)*.jpg',
    ':(exclude)*.jpeg',
  ])

  const systemPrompt = `
${getSystemPrompt()}

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
`

  // Ask LLM for a better commit message
  const promptMsg = `
Current commit message: "${lastCommit.message}"

Specific commit diff:
${commitDiff}

Full branch context (all changes from upstream to HEAD):
${fullDiff}
`

  logger.info(yellow(`Requesting commit message analysis from AI with comprehensive context...`))
  const res = await generateCompletion('ollama', {
    prompt: `${systemPrompt}${promptMsg}`,
  })

  try {
    const analysis = JSON.parse(res.text)

    if (analysis.needsImprovement) {
      logger.info(green(`AI suggests improving the last commit message`))
      logger.box({
        title: 'Commit Message Comparison',
        current: lastCommit.message,
        improved: analysis.improvedCommitMessage,
        reason: analysis.reason,
      })

      const amendConfirm = await logger.prompt(
        green(`Amend commit ${lastCommit.hash.substring(0, 7)} with the improved message?`),
        {
          type: 'confirm',
        },
      )

      if (amendConfirm) {
        logger.info(green(`Amending last commit ${lastCommit.hash.substring(0, 7)}...`))

        // Amend the last commit with the new message
        await git.raw(['commit', '--amend', '-m', analysis.improvedCommitMessage])

        // Mark the amended commit as created by our tool
        await markCommitAsCreatedByTool(git, 'HEAD')

        logger.success(green(`Last commit amended successfully`))
      } else {
        logger.info(yellow(`Skipping amendment for last commit`))
      }
    } else {
      logger.info(yellow(`No changes needed for last commit: ${analysis.reason}`))
    }
  } catch (e) {
    logger.error(red(`Failed to optimize last commit`))
    logger.debug('Raw response:', res)
  }

  // Log the updated commit message
  const updatedCommit = await git.log(['-1'])
  logger.info(green('Last commit after optimization:'))
  logger.info(`${updatedCommit.latest?.hash.substring(0, 7)} - ${updatedCommit.latest?.message}`)

  logger.success(green('Commit message optimization complete'))
}

/**
 * Creates a new branch and pushes it to remote, then creates a PR
 *
 * Uses AI to generate a branch name, PR title, and PR description based on the
 * latest commit message.
 *
 * @param git - SimpleGit instance
 * @param upstreamBranch - Name of the upstream branch
 */
async function createAndPushPR(git: SimpleGit, upstreamBranch: string) {
  logger.info(green('Preparing to create a new branch and PR'))

  // Get the latest commit to use for branch name suggestion and PR details
  logger.info(yellow('Fetching latest commit for PR details...'))
  const latestCommit = await git.log(['-1'])
  const commitMessage = latestCommit.latest?.message || ''

  // Get current branch
  const branchSummary = await git.branch()
  const currentBranch = branchSummary.current

  const generatePrDetails = await logger.prompt(green('Generate PR details with AI based on your commits?'), {
    type: 'confirm',
  })

  if (!generatePrDetails) {
    logger.info(yellow('PR creation cancelled'))
    return
  }

  // Generate PR details using LLM
  logger.info(yellow('Requesting PR suggestions from AI...'))
  // get existing branch names to exclude them from suggestions
  const existingBranches = await git.branchLocal()
  const existingBranchNames = existingBranches.all.map((branch) => branch.trim()).join(', ')

  const systemPrompt = `
${getSystemPrompt()}

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
`

  const prPrompt = `
Based on this commit message, suggest a branch name, PR title and description for a pull request:

Commit message: ${commitMessage}
`

  const res = await generateCompletion('ollama', {
    prompt: `${systemPrompt}${prPrompt}`,
  })

  let prData
  try {
    prData = JSON.parse(res.text)

    // Show PR details and confirm
    logger.box({
      title: 'Pull Request Details',
      branch: prData.suggestedBranchName,
      prTitle: prData.prTitle,
      description: prData.prDescription,
    })

    const createPRConfirm = await logger.prompt(green('Create PR with these details?'), {
      type: 'confirm',
    })

    if (createPRConfirm) {
      let branchToPush = currentBranch
      const targetBranchName = upstreamBranch.replace('origin/', '')

      // Only create a new branch if the current branch is the target branch
      if (currentBranch === targetBranchName) {
        // Create new branch
        logger.info(
          yellow(`Current branch is the same as target branch. Creating new branch: ${prData.suggestedBranchName}...`),
        )
        const createBranchConfirm = await logger.prompt(
          green(`Confirm creation of branch "${prData.suggestedBranchName}"?`),
          {
            type: 'confirm',
          },
        )

        if (!createBranchConfirm) {
          logger.info(yellow('Branch creation cancelled'))
          return
        }

        await git.checkoutLocalBranch(prData.suggestedBranchName)
        branchToPush = prData.suggestedBranchName
        logger.success(green(`Created and switched to branch: ${branchToPush}`))
      } else {
        logger.info(yellow(`Using current branch "${currentBranch}" for PR`))
      }

      // Push to remote
      logger.info(yellow(`Preparing to push branch "${branchToPush}" to remote...`))
      const pushConfirm = await logger.prompt(green('Push branch to remote repository?'), {
        type: 'confirm',
      })

      if (!pushConfirm) {
        logger.info(yellow('Remote push cancelled'))
        return
      }

      logger.info(yellow('Pushing to remote repository...'))
      await git.push('origin', branchToPush, ['--set-upstream'])
      logger.success(green(`Pushed branch to remote`))

      // Create PR using GitHub CLI if available, otherwise provide instructions
      logger.info(yellow('Creating pull request...'))
      const createGhPrConfirm = await logger.prompt(green('Create GitHub PR using GitHub CLI?'), {
        type: 'confirm',
      })

      if (createGhPrConfirm) {
        try {
          const { execa } = await import('execa')
          const upstreamTarget = upstreamBranch.replace('origin/', '')

          logger.info(yellow('Creating PR using GitHub CLI...'))
          await execa('gh', [
            'pr',
            'create',
            '--title',
            prData.prTitle,
            '--body',
            prData.prDescription,
            '--base',
            upstreamTarget,
          ])

          logger.success(green('Pull request created successfully!'))
        } catch (e) {
          // Provide manual instructions if GitHub CLI fails or is not available
          logger.warn(yellow('Could not automatically create PR. Please create it manually with:'))
          logger.info(`
Title: ${prData.prTitle}
Description: 
${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
`)
        }
      } else {
        logger.info(yellow('GitHub CLI PR creation skipped. Create PR manually using:'))
        logger.info(`
Title: ${prData.prTitle}
Description: 
${prData.prDescription}
From: ${branchToPush}
To: ${upstreamBranch.replace('origin/', '')}
`)
      }
    } else {
      logger.info(yellow('PR creation cancelled'))
    }
  } catch (e) {
    logger.error(red('Failed to parse LLM response for PR details'))
    logger.debug('Raw response:', res)
  }
}

/**
 * Returns a system prompt for use with LLM requests
 *
 * Currently empty but can be used to add standard instructions for all LLM prompts
 */
function getSystemPrompt() {
  return ''
}

/**
 * Generates a prompt for LLM to analyze diff changes
 *
 * This combines a system prompt with the diff changes to form a complete
 * prompt for the LLM to generate PR metadata.
 *
 * @param diffChanges - String containing git diff output
 * @returns Complete prompt string for LLM
 */
function generateLlmPrompt(diffChanges: string) {
  const systemPrompt = `
  ${getSystemPrompt()}
  
ALWAYS Format your response as a JSON object with the following length and structure:
- suggestedBranchName: max 50 characters
- commitMessage: max 120 characters
- prTitle: max 100 characters
- prDescription: max 2000 characters
and the following structure:
{
  "suggestedBranchName": "feature/your-feature-name", 
  "commitMessage": "type(scope): summary of changes detailed explanation of changes...",
  "prTitle": "type(scope): PR Title",
  "prDescription": "## Summary [Comprehensive description with all sections outlined above]"
}
`

  const userPrompt = `
PLEASE ANALYZE THE FOLLOWING GIT DIFF AND GENERATE A RESPONSE AS REQUESTED.
Diff Changes: ${diffChanges}

// Ignore pnpm-lock.yaml, yarn.lock, package-lock.json, and similar files in the analysis.
`
  return `${systemPrompt}${userPrompt}`
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
const _ = generateLlmPrompt('')
