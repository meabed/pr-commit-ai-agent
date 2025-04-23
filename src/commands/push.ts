import * as process from 'node:process'
import { logger } from '../logger'
import { green, red } from 'picocolors'
import { simpleGit, SimpleGit } from 'simple-git'
import { LLMService } from '../services/llm'

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
      // find the upstream branch that is being tracked or this branched off of
      // get all changes that are not committed or diff from the upstream branch
      // const changes = await git.diffSummary(['HEAD', 'origin/master'])
      const modifiedFiles = status.modified?.filter((e) => {
        return !['pnpm-lock.yaml', 'package-lock.json', 'tsconfig.json'].includes(e)
      })
      const tempModified = [] as string[]
      for (const file of modifiedFiles) {
        const diff = await git.diff([file])
        tempModified.push(`
filename: ${file}
diff changes: ${diff}
____________=========================____________
`)
      }

      // const excludePaths = [':(exclude)pnpm-lock.yaml']
      // const changeString = await git.diff(['--word-diff=porcelain', 'HEAD', 'origin/master', 'src', ...excludePaths])
      // ignore pnpm_lock.yaml and package-lock.json
      // const changes = await git.diffSummary(['HEAD', 'origin/master'], {
      // get all changes in template string format filename new line diff separator
      // const changesString = changes.files
      //   .map((file) => {
      //     return `
      //     filename: ${file.file}
      //     diff changes: ${file.changes}`
      //   })
      //   .join('\n ------------------------------ \n')
      // logger.log(green(`Changes:`), changeString)
      const llmService = new LLMService()
      const promptMsg = `
You are a senior software architect and code review expert with extensive experience in version control best practices. Analyze the provided git diff and generate the following high-quality outputs:

## 1. Commit Message
Create a well-structured commit message following conventional commit format:
- First line (50-72 characters): Clear, concise summary using imperative mood (e.g., "Fix", "Add", "Update", not "Fixed", "Added", "Updated")
- Type prefix according to conventional commits (feat, fix, docs, style, refactor, perf, test, build, ci, chore)
- Blank line after summary
- Detailed explanation of changes, their rationale, and impact (bullet points preferred)
- Reference any relevant issue/ticket numbers with appropriate keywords (Fixes #123, Closes #456, Relates to #789)

## 2. Pull Request Title
- Create a clear, descriptive PR title (60-100 characters)
- Begin with appropriate type prefix (same as commit convention)
- Focus on the main purpose of the changes
- Include scope if applicable (e.g., "feat(auth): Implement OAuth2 authentication flow")

## 3. Pull Request Description
Generate a comprehensive PR description including:
- Summary section explaining the overall purpose and context
- Problem statement: What issue is being solved?
- Solution details: How the code changes address the problem
- Technical implementation details:
  * Architecture changes
  * New dependencies introduced
  * Database schema changes
  * API changes (new endpoints, modified parameters, etc.)
  * UI changes with description of user experience impacts
- Potential risks and mitigations
- Testing approach: How the changes were tested
- Migration instructions if applicable (e.g., database migrations, config changes)
- Screenshots/GIFs if UI changes are included (indicate where they would be placed)
- Documentation updates required

## 4. Analysis Guidelines
- Identify change patterns (e.g., consistent variable renaming across files suggests intentional refactoring)
- Recognize code smells or potential bugs in the changes
- Consider edge cases that might not be handled
- Evaluate test coverage of the changes
- Assess performance implications
- Identify security considerations
- Note any architectural pattern changes
- Check for appropriate error handling

## 5. Classification Rules
Based on file patterns and code change patterns, classify the change appropriately:

- Bug fix: Contains changes that correct incorrect behavior
  * Keywords: null checks, boundary conditions, exception handling, validation
  * If identified, include "fix: " prefix and "Fixes #[issue]" in commit message

- Feature: Adds new functionality
  * Keywords: new components, new API endpoints, new UI elements
  * If identified, include "feat: " prefix and "Implements #[feature]" in commit message

- Refactor: Code improvements without behavior changes
  * Keywords: renaming, restructuring, pattern application
  * If identified, include "refactor: " prefix and "Refactors #[component/area]" in commit message

- Documentation: Updates to comments, JSDoc, README, etc.
  * If identified, include "docs: " prefix and "Updates docs for #[area]" in commit message

- Performance: Optimizations for speed or resource usage
  * Keywords: memoization, indexing, caching, lazy loading
  * If identified, include "perf: " prefix and "Optimizes #[area]" in commit message

- Security: Addresses security vulnerabilities
  * Keywords: sanitization, validation, authentication, authorization
  * If identified, include "security: " prefix and "Fixes vulnerability #[CVE/issue]" in commit message

- Test: Changes to test files or test infrastructure
  * If identified, include "test: " prefix and "Improves test coverage for #[area]" in commit message

- Build: Changes to build scripts, CI configuration
  * If identified, include "build: " prefix and "Updates build process for #[area]" in commit message

## 6. File Focus
- Prioritize analysis on files in src/ directory
- Focus on functional code changes, not formatting or auto-generated files
- Ignore changes to:
  * lock files (package-lock.json, yarn.lock, pnpm-lock.yaml)
  * Auto-generated files (*.min.js, *.generated.*)
  * Config files without functional impact (tsconfig.json, .eslintrc, etc.)
  * Binary files (images, fonts)
  * Dependencies version bumps without code changes

## 7. Review Importance
- Assign higher importance to:
  * Core business logic files
  * Security-sensitive areas (authentication, authorization, input validation)
  * Performance-critical paths
  * API contracts and interfaces
  * Database schema changes

## 8. Pattern Recognition 
- Identify and note common refactoring patterns:
  * Extract method/component
  * Rename variable/function/class
  * Move method/function
  * Replace conditional with polymorphism
  * Introduce design pattern

Git Diff Changes: ${tempModified.join('\n')}

Format your response as a JSON object with the following structure:
{
  "commitMessage": "type(scope): Summary of changes\n\nDetailed explanation of changes...",
  "prTitle": "type(scope): PR Title",
  "prDescription": "## Summary\n[Comprehensive description with all sections outlined above]"
}
\`;
`
      logger.log('promptMsg', promptMsg)
      const res = await llmService.generateCompletion('ollama', {
        temperature: 0.1,
        messages: [
          // {
          //   id: new Date().toISOString() + '1',
          //   role: 'system',
          //   content:
          //     'You are a senior software architect and code review expert with extensive experience in version control best practices. Analyze the provided git diff and generate the following high-quality outputs:',
          // },
          {
            id: new Date().toISOString() + '2',
            content: promptMsg,
            role: 'user',
          },
        ],
      })
      logger.log(green(`AI Response:`), res)
      if (status.isClean()) {
        logger.error(red(`No changes to commit!`))
        return
      }
      logger.box(green(`Git status:`), {
        type: 'info',
        content: status,
      })
    } catch (e) {
      logger.error(red((e as Error).message))
    }
  }
}
