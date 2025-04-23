# Commit PR Agent

A TypeScript CLI tool that uses LLMs to help developers generate better commit messages, PR descriptions, and automate GitHub PR creation.

[![NPM Version](https://img.shields.io/npm/v/commit-pr-agent.svg)](https://www.npmjs.com/package/commit-pr-agent)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/meabed/pr-commit-agent/ci.yml?branch=main)](https://github.com/meabed/pr-commit-agent/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🤖 Analyzes code changes using LLMs (OpenAI, Azure, Anthropic, or custom endpoints)
- 📝 Generates meaningful commit messages based on your changes
- 📄 Creates detailed PR descriptions automatically
- 🔄 Can commit, push, and open PRs in one command
- 🔧 Highly configurable to fit your workflow
- ⚙️ Works on macOS, Windows, and Linux

## Installation

### Global Installation

```bash
npm install -g commit-pr-agent
```

### Local Project Installation

```bash
npm install --save-dev commit-pr-agent
```

## Quick Start

1. First, you need to set your API keys:

```bash
# For GitHub access
export GITHUB_TOKEN=your_github_token

# For OpenAI (default LLM provider)
export OPENAI_API_KEY=your_openai_api_key
```

2. Navigate to a git repository with uncommitted changes

3. Run the tool:

```bash
commit-pr-agent generate
```

4. Follow the interactive prompts to commit, push, and create a PR

## Configuration

You can configure the tool using:

1. Environment variables
2. A `.commit-pr-agentrc` file in your home directory or project root
3. A custom config file specified with the `--config` option

### Example Configuration File

```json
{
  "github": {
    "token": "your_github_token",
    "owner": "your_github_username",
    "repo": "your_repo_name",
    "baseBranch": "main"
  },
  "llm": {
    "provider": "openai",
    "apiKey": "your_api_key",
    "model": "gpt-4o-mini"
  },
  "git": {
    "authorName": "Your Name",
    "authorEmail": "your.email@example.com"
  }
}
```

### LLM Provider Options

Currently supported LLM providers:

- `openai` - OpenAI API (default)
- `azure` - Azure OpenAI Service
- `anthropic` - Anthropic Claude
- `custom` - Custom API endpoint

For Azure and custom providers, you need to specify an endpoint URL:

```json
{
  "llm": {
    "provider": "azure",
    "apiKey": "your_azure_api_key",
    "model": "gpt-4",
    "endpoint": "https://your-resource.openai.azure.com/deployments/your-deployment/chat/completions?api-version=2023-03-15-preview"
  }
}
```

## Commands

### Generate

```
commit-pr-agent generate [options]
```

Analyzes your git changes and generates commit messages and PR descriptions.

Options:
- `-c, --config <path>`: Path to config file
- `-b, --branch <name>`: Branch name to create PR from
- `-d, --dry-run`: Show what would be done without making changes
- `-v, --verbose`: Show verbose output
- `--auto-commit`: Automatically commit changes without prompting
- `--auto-push`: Automatically push changes without prompting  
- `--open-pr`: Automatically open PR in browser after creation

### Init (Coming Soon)

```
commit-pr-agent init
```

Interactively creates a configuration file.

## Development

### Prerequisites

- Node.js 14 or higher
- npm or yarn
- Git

### Setup

```bash
# Clone the repo
git clone https://github.com/meabed/pr-commit-agent.git
cd pr-commit-agent

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add some amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
