import * as process from 'node:process'
import { logger } from '../logger'
import { green, red, yellow } from 'picocolors'
import { simpleGit, SimpleGit, StatusResult } from 'simple-git'
import { generateCompletion } from '../services/llm'

export const command = 'push'
export const describe = 'Create PR and push to remote'
export const aliases = ['c']

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
const ignoredFiles = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'tsconfig.json']
const PR_AGENT_NOTE_NAMESPACE = 'pr-agent'
const PR_AGENT_NOTE_MESSAGE = 'created-by-pr-agent'

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

    // Ask user which branch to target
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

  const modifiedFiles =
    status.modified?.filter((e) => {
      return !ignoredFiles.includes(e)
    }) || []

  const tempModified = [] as string[]
  for (const file of modifiedFiles) {
    logger.info(yellow(`Analyzing changes in: ${file}`))
    const diff = await git.diff([file])
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
      const commitResult = await git.commit(commitData.commitMessage)

      // Mark this commit as created by pr-agent using git notes
      if (commitResult.commit) {
        await markCommitAsCreatedByTool(git, commitResult.commit)
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

async function optimizeCommitMessages(git: SimpleGit, upstreamBranch: string) {
  logger.info(yellow('Starting commit message optimization process...'))

  // Get all commits between current HEAD and upstream branch
  logger.info(yellow('Fetching commits to optimize...'))
  const commits = await git.log({
    from: upstreamBranch,
    to: 'HEAD',
  })

  if (!commits.all.length) {
    logger.info(yellow('No commits to optimize'))
    return
  }

  logger.info(green(`Found ${commits.all.length} commit(s) to optimize`))

  // Show all commits that will be processed
  logger.info(yellow('The following commits will be analyzed for optimization:'))

  // Process commits in reverse order (oldest first)
  const commitsToProcess = [...commits.all].reverse()
  commitsToProcess.forEach((commit, index) => {
    logger.info(`${index + 1}. ${commit.hash.substring(0, 7)} - ${commit.message}`)
  })

  const continueOptimization = await logger.prompt(green('Continue with commit message optimization?'), {
    type: 'confirm',
  })

  if (!continueOptimization) {
    logger.info(yellow('Commit message optimization cancelled'))
    return
  }

  // Process commits in reverse order (oldest first)
  for (const commit of commitsToProcess) {
    // Check if this is a merge commit (has multiple parents)
    const revList = await git.raw(['rev-list', '--parents', '-n', '1', commit.hash])
    const parentHashes = revList.trim().split(' ')

    // If there are more than 2 entries (commit hash + parent hashes), it's a merge commit
    if (parentHashes.length > 2) {
      logger.info(yellow(`Skipping merge commit: ${commit.hash.substring(0, 7)} - ${commit.message}`))
      continue
    }

    // Check if the commit was created by this tool in the current session
    const isToolCommit = await isCommitCreatedByTool(git, commit.hash)
    if (isToolCommit) {
      logger.info(yellow(`Skipping commit created by PR Agent: ${commit.hash.substring(0, 7)} - ${commit.message}`))
      continue
    }

    // Get commit diff
    logger.info(yellow(`Analyzing commit: ${commit.hash.substring(0, 7)} - ${commit.message}`))
    // ignore pnpm-lock.yaml, yarn.lock, package-lock.json, and similar files in the analysis ':!some/path' ':!some/other/path'
    const diff = await git.show([
      commit.hash,
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

First, analyze the commit message and determine if it needs improvement based on conventional commit best practices.
Then, if it needs improvement, provide a better commit message that clearly describes the change using the conventional commit format 
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
Current commit message: "${commit.message}"

Commit diff:
${diff}
`

    logger.info(yellow(`Requesting commit message analysis from AI...`))
    const res = await generateCompletion('ollama', {
      prompt: `${systemPrompt}${promptMsg}`,
    })

    try {
      const analysis = JSON.parse(res.text)

      if (analysis.needsImprovement) {
        logger.info(green(`AI suggests improving this commit message`))
        logger.box({
          title: 'Commit Message Comparison',
          current: commit.message,
          improved: analysis.improvedCommitMessage,
          reason: analysis.reason,
        })

        const amendConfirm = await logger.prompt(
          green(`Amend commit ${commit.hash.substring(0, 7)} with the improved message?`),
          {
            type: 'confirm',
          },
        )

        if (amendConfirm) {
          logger.info(green(`Amending commit ${commit.hash.substring(0, 7)}...`))

          // Reset to the parent of the commit to amend
          await git.raw(['reset', '--soft', `${commit.hash}^`])

          // Re-commit the changes with the new message
          const newCommit = await git.commit(analysis.improvedCommitMessage, ['--no-edit', '--allow-empty'])

          // Mark the new commit as created by our tool
          if (newCommit.commit) {
            await markCommitAsCreatedByTool(git, newCommit.commit)
          }

          logger.success(green(`Commit ${commit.hash.substring(0, 7)} amended successfully`))
        } else {
          logger.info(yellow(`Skipping amendment for commit ${commit.hash.substring(0, 7)}`))
        }
      } else {
        logger.info(yellow(`No changes needed for commit ${commit.hash.substring(0, 7)}: ${analysis.reason}`))
      }
    } catch (e) {
      logger.error(red(`Failed to optimize commit ${commit.hash.substring(0, 7)}`))
      logger.debug('Raw response:', res)
    }
  }

  // Log the list of commits and their messages after optimization
  const updatedCommits = await git.log({
    from: upstreamBranch,
    to: 'HEAD',
  })
  logger.info(green('Updated list of commits after optimization:'))
  updatedCommits.all.forEach((commit) => {
    logger.info(`${commit.hash.substring(0, 7)} - ${commit.message}`)
  })

  logger.success(green('Commit message optimization complete'))
}

async function createAndPushPR(git: SimpleGit, upstreamBranch: string) {
  logger.info(green('Preparing to create a new branch and PR'))

  // Get the latest commit to use for branch name suggestion and PR details
  logger.info(yellow('Fetching latest commit for PR details...'))
  const latestCommit = await git.log(['-1'])
  const commitMessage = latestCommit.latest?.message || ''

  const generatePrDetails = await logger.prompt(green('Generate PR details with AI based on your commits?'), {
    type: 'confirm',
  })

  if (!generatePrDetails) {
    logger.info(yellow('PR creation cancelled'))
    return
  }

  // Generate PR details using LLM
  logger.info(yellow('Requesting PR suggestions from AI...'))
  const systemPrompt = `
${getSystemPrompt()}

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
      // Create new branch
      logger.info(yellow(`Creating new branch: ${prData.suggestedBranchName}...`))
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
      logger.success(green(`Created and switched to branch: ${prData.suggestedBranchName}`))

      // Push to remote
      logger.info(yellow('Preparing to push branch to remote...'))
      const pushConfirm = await logger.prompt(green('Push branch to remote repository?'), {
        type: 'confirm',
      })

      if (!pushConfirm) {
        logger.info(yellow('Remote push cancelled'))
        return
      }

      logger.info(yellow('Pushing to remote repository...'))
      await git.push('origin', prData.suggestedBranchName, ['--set-upstream'])
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
From: ${prData.suggestedBranchName}
To: ${upstreamBranch.replace('origin/', '')}
`)
        }
      } else {
        logger.info(yellow('GitHub CLI PR creation skipped. Create PR manually using:'))
        logger.info(`
Title: ${prData.prTitle}
Description: 
${prData.prDescription}
From: ${prData.suggestedBranchName}
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

function getSystemPrompt() {
  return ''
}

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
