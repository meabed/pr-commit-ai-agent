# PR Commit AI Agent (GGPR)

GGPR is an intelligent CLI tool that leverages AI to enhance your Git workflow, particularly for creating high-quality commit messages and pull requests. It helps developers maintain better documentation of code changes, follow best practices, and create more descriptive PRs with minimal effort.

## Features

- 🤖 **AI-Generated Commit Messages** - Automatically analyze your changes and create conventional commit messages
- 🔄 **Commit Message Optimization** - Improve existing commit messages with AI suggestions
- 🌿 **Smart Branch Names** - Generate meaningful branch names based on your changes
- 📝 **PR Description Generation** - Create comprehensive PR descriptions and titles automatically
- 🛠️ **Multiple LLM Support** - Works with OpenAI, Anthropic, Ollama, and DeepSeek
- 🔌 **Local LLM Compatibility** - Use with local models through Ollama for privacy

## Prerequisites

Before you begin, ensure you have installed:
- [Node.js](https://nodejs.org/) (v18 or later)
- [pnpm](https://pnpm.io/) package manager
- Git

## Getting Started

### 1. Installation

```bash
# Global installation
npm install -g pr-commit-ai-agent

# Or with pnpm
pnpm add -g pr-commit-ai-agent

# Or run from the repository
git clone https://github.com/meabed/pr-commit-ai-agent.git
cd pr-commit-ai-agent
pnpm install
```

### 2. Configure your LLM provider

Create a `.env` file in the root directory with your API keys:

```env
# OpenAI (optional)
OPENAI_API_KEY=your_key_here

# Anthropic (optional)
ANTHROPIC_API_KEY=your_key_here

# DeepSeek (optional)
DEEPSEEK_API_KEY=your_key_here

# Ollama (optional, for local models)
OLLAMA_BASE_URL=http://localhost:11434/api
```

Only configure the providers you intend to use. By default, the tool will use Ollama if available locally.

## Usage

GGPR can be used with the `ggpr` command:

### Create a PR with AI assistance

```bash
# Interactive mode
ggpr

# Auto-confirm all prompts
ggpr --yes

# Log all LLM requests for debugging
ggpr --log-request
```

The `create` command (the default command) will:
1. Determine the target branch for your PR
2. Handle uncommitted changes with AI-generated commit messages
3. Optimize existing commit messages to follow best practices
4. Create a branch with an AI-generated name (if needed)
5. Create a PR with an AI-generated title and description

### Get repository information

```bash
ggpr info
```

## Command Options

### Create Command

- `--yes`, `-y`: Automatically confirm all prompts
- `--log-request`, `-l`: Log all LLM requests and responses

## Development

To contribute to this project or customize it for your needs:

```bash
# Clone the repository
git clone https://github.com/meabed/pr-commit-ai-agent.git
cd pr-commit-ai-agent

# Install dependencies
pnpm install

# Run in development mode
pnpm start create
```

### Script Commands

- `pnpm build` - Build the project using `tsup`
- `pnpm build:watch` - Automatically rebuild on file changes
- `pnpm commit` - Run commitizen for standardized commit messages
- `pnpm format` - Check files for code style issues
- `pnpm format:fix` - Fix code formatting issues
- `pnpm lint` - Check code for style issues
- `pnpm lint:fix` - Fix code style issues
- `pnpm start [command]` - Run the CLI using `ts-node`
- `pnpm test` - Run unit tests

## CI/CD and Automation

This project uses semantic-release for automated versioning and NPM publishing based on conventional commit messages. When changes are merged into the main branch:

1. The version is automatically incremented based on commit types
2. Release notes are generated from commit messages
3. The package is published to NPM with the new version

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Follow the code style using Prettier and ESLint
2. Use conventional commits (run `pnpm commit` to use the interactive tool)
3. Write tests for new features
4. Make sure your changes pass linting and tests before submitting a PR

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
