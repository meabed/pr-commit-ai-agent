I'll help you refine this prompt to make it clearer for large language models when building agentic code for a CLI app in Node.js and TypeScript. Let me restructure and enhance your instructions for better clarity and comprehensiveness.

# GGPR: AI-Powered Git Workflow CLI Tool

## Project Overview
GGPR is an AI-powered CLI tool that supercharges Git workflows by automatically generating high-quality commit messages, branch names, and pull requests. The tool aims to save developers time, improve documentation quality, and automate tedious parts of the development process.

## Development Guidelines

### File & Naming Conventions
- Use kebab-case for all file names (e.g., `git-helper.ts`, `commit-message-generator.ts`)
- Ensure component/class names match their file names (but in PascalCase for classes/components)
- Use camelCase for constants, variables, and function names (not UPPER_SNAKE_CASE)

### TypeScript Best Practices
- Use TypeScript throughout the entire project
- Define explicit types for all variables, parameters, return values, and components
- Avoid using `any` type - use proper type definitions, generics, or `unknown` when necessary
- Use interface or type for complex data structures
- Leverage TypeScript's utility types when appropriate (Pick, Omit, Partial, etc.)
- Include type definitions for external libraries or create custom type definitions if needed

### Code Structure & Organization
- Prefer named exports over default exports
  ```typescript
  // Preferred
  export function generateCommitMessage() { ... }
  
  // Instead of
  export default function() { ... }
  ```
- Use function declarations over arrow function constants where appropriate
  ```typescript
  // Preferred
  export function processGitStatus(status: StatusResult) { ... }
  
  // Instead of
  export const processGitStatus = (status: StatusResult) => { ... }
  ```
- Organize related functionality into modules with clear responsibilities
- Follow existing code structure and practices in the project

### Code Quality & Safety
- Use optional chaining (`?.`) and nullish coalescing (`??`) operators to handle potential null/undefined values
  ```typescript
  const branchName = gitData?.currentBranch?.name ?? 'main';
  ```
- Write comprehensive error handling for all external operations (Git commands, API calls)
- Include meaningful logging at appropriate levels
- Write clean, maintainable code with consistent formatting
- Use ESLint and Prettier configurations consistent with the project
- Use early returns to avoid deep nesting and improve readability

### Dependencies
- Use the latest stable versions of well-maintained libraries from npm
- Prefer libraries with TypeScript support and active maintenance
- For Git operations, use the `simple-git` package
- For CLI argument parsing, use `yargs`
- For LLM interactions, use the project's `generateCompletion` service

### Example Dependencies
```typescript
import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import { generateCompletion, LLMProvider } from '../services/llm';
import { ArgumentsCamelCase, Argv } from 'yargs';
import { PromptOptions } from 'consola';
import { config } from '../config';
```

### External Tools Integration
- Use GitHub CLI for PR creation through `execa` for command execution:
```typescript
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
```

## Implementation Notes
- Break down functionality into modular, testable components
- Ensure good user experience through clear messaging and progress indicators
- Implement intelligent fallbacks when AI services are unavailable
- Consider caching strategies to improve performance
- Include comprehensive help documentation for CLI commands

Does this refined prompt structure better meet your needs for guiding an LLM to build your agentic Git CLI tool? I've organized it into clear sections with specific examples that should help the model understand exactly what you're looking for.
