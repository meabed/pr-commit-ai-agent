help me to refine the prompt to make it clear for large language models building agentic code for cli app in nodejs and typescript
The GGPR is an AI-powered CLI tool that **supercharges your Git workflow** by generating high-quality commit messages, branch names, and pull requests. Save time, improve documentation, and let AI handle the tedious parts of your development process!

- use kebab-case for file names
- use functions over const in methods as much as possible
- use named export over default exports as much as possible
- use typescript and define types for all the components and screens properly and avoid use any or wrong types
- use latest and well maintained libraries from npm and github
- ensure component name is same as file name with kebab-case
- for constants use camelCase instead of full caps
- use null coalescing ?. to make sure value safety and null check and the code doesn't break of undefined and nulls
- write clean code, high quality and maintainable code
- use typescript types and imports properly and Avoid using "any" types as much as you can
- always look in the surrounding files and structure to understand the current code structure and practices and to follow the same
- use early returns to avoid deep nesting and improve readability

- some library and code used

```
import { simpleGit, SimpleGit, StatusResult } from 'simple-git';
import { generateCompletion, LLMProvider } from '../services/llm';
import { ArgumentsCamelCase, Argv } from 'yargs';
import { PromptOptions } from 'consola';
import { config } from '../config';

// GitHub CLI
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
