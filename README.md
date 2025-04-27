# GGPR - PR & Commit AI Assistant

GGPR is an intelligent CLI tool that uses AI to enhance your Git workflow, creating high-quality commit messages and pull requests with minimal effort.

[![NPM Version](https://img.shields.io/npm/v/pr-commit-ai-agent.svg)](https://www.npmjs.com/package/pr-commit-ai-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/meabed/pr-commit-ai-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/meabed/pr-commit-ai-agent/actions/workflows/ci.yml)

<div align="center">
  <img src="https://raw.githubusercontent.com/meabed/pr-commit-ai-agent/main/assets/demo.gif" alt="GGPR Demo" width="800"/>
</div>

## 🚀 Features

- **AI-Generated Commit Messages** - Create semantic commits that follow best practices
- **Commit Message Optimization** - Improve existing messages with AI suggestions
- **Smart Branch Names** - Generate descriptive branch names based on your changes
- **Automated PR Creation** - Generate PR titles, descriptions, and create them automatically
- **Multiple LLM Support** - Choose from OpenAI, Anthropic, Ollama, or DeepSeek
- **Local AI Integration** - Use with local models through Ollama for privacy
- **Customizable Workflows** - Configure prompts and behavior to match your team's practices
- **GitHub CLI Integration** - Seamless creation of PRs via GitHub CLI when available

## 📋 Requirements

- **Node.js** v18+
- **pnpm** (recommended) or npm
- **Git** v2.25+
- **GitHub CLI** (optional) for PR creation

## 🛠️ Installation

### Global Installation (for users)

```bash
# Install globally with npm
npm install -g pr-commit-ai-agent

# Or with pnpm (recommended)
pnpm add -g pr-commit-ai-agent
```

### Development Installation (for contributors)

```bash
# Clone the repository
git clone https://github.com/meabed/pr-commit-ai-agent.git
cd pr-commit-ai-agent

# Install dependencies
pnpm install

# Link the package globally
pnpm link --global
```

## ⚙️ Configuration

### Option 1: Interactive Configuration (Recommended)

```bash
# Run the interactive configuration wizard
ggpr config
```

### Option 2: Environment Variables

```bash
# Set for current session
export LLM_PROVIDER=openai
export OPENAI_API_KEY=your_key_here

# Or pass inline for a single command
LLM_PROVIDER=ollama MODEL=qwen2.5-coder OLLAMA_BASE_URL=http://0.0.0.0:11434/api/generate ggpr create
```

### Option 3: Configuration File
- run `ggpr config` to find the config file location, for example (`~/.config/pr-commit-ai-agent-nodejs/config.json`)
- modify the config file to set your preferred settings

### Available Environment Variables

| Environment Variable | Description                                                      | Default                      |
| -------------------- | ---------------------------------------------------------------- | ---------------------------- |
| `LLM_PROVIDER`       | AI provider to use (`openai`, `anthropic`, `ollama`, `deepseek`) | `openai`                     |
| `OPENAI_API_KEY`     | OpenAI API key                                                   | -                            |
| `ANTHROPIC_API_KEY`  | Anthropic API key                                                | -                            |
| `DEEPSEEK_API_KEY`   | DeepSeek API key                                                 | -                            |
| `OLLAMA_BASE_URL`    | URL for Ollama API                                               | `http://localhost:11434/api` |
| `OLLAMA_API_KEY`     | API key for Ollama (if needed)                                   | -                            |
| `MODEL`              | Override default model for selected provider                     | Provider-specific            |

## 📝 Usage

### Create Command (Default)

Guides you through creating AI-enhanced commits, optimizing messages, and creating a PR.

```bash
# Basic usage (interactive)
ggpr create

# Or just:
ggpr

# Auto-confirm all prompts
ggpr create --yes

# Log all LLM requests for debugging
ggpr create --log-request

# Combine flags
ggpr create --yes --log-request

# Skip PR creation
ggpr create --no-pr
```

### Info Command

Shows repository information and status.

```bash
ggpr info

# Show detailed information
ggpr info --full
```

### Config Command

Manage your GGPR configuration settings.

```bash
# View and modify current config
ggpr config
```

## 📚 Command Reference

### Common Options

These flags work with most commands:

| Flag           | Alias | Description                               |
|----------------|-------|-------------------------------------------|
| `--help`       | `-h`  | Show help information                     |
| `--version`    | `-v`  | Show version information                  |

### Create Command Options

| Flag           | Description                                       |
|---------------|---------------------------------------------------|
| `--yes`        | `-y`  | Auto-confirm all prompts                  |
| `--log-request`| `-l`  | Log LLM API requests for debugging        |
| `--no-pr`     | Generate commit description and commit only without creating PR |

### Config Command Options


## 🚶 Workflow

The `create` command workflow:

1. **Target Branch Selection** - Choose which branch to target for your PR
2. **Uncommitted Changes** - Generate an AI commit message for your changes
3. **Commit Optimization** - AI improves your existing commit messages
4. **Branch Creation** - Creates a branch with an AI-generated name if needed
5. **PR Creation** - Creates a PR with AI-generated title and description

## 🛠️ Development

### Quick Start for Contributors

```bash
# Clone and setup
git clone https://github.com/meabed/pr-commit-ai-agent.git
cd pr-commit-ai-agent
pnpm install

# Development mode
pnpm start create

# Testing
pnpm test

# Build
pnpm build
```

### Available Scripts

| Command            | Description                                 |
| ------------------ | ------------------------------------------- |
| `pnpm build`       | Build the project using tsup                |
| `pnpm build:watch` | Build with file watching                    |
| `pnpm start [cmd]` | Run the CLI using ts-node                   |
| `pnpm commit`      | Use commitizen for standard commit messages |
| `pnpm format`      | Check code formatting                       |
| `pnpm format:fix`  | Fix code formatting issues                  |
| `pnpm lint`        | Check for code style issues                 |
| `pnpm lint:fix`    | Fix code style issues                       |
| `pnpm test`        | Run unit tests                              |
| `pnpm release`     | Create a new release                        |

## 🤝 Contributing

We welcome contributions of all sizes! Here's how you can help:

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

<div align="center">
  <p>Made with ❤️ by <a href="https://github.com/meabed">Mohamed Meabed</a> and contributors</p>
  <p>
    <a href="https://github.com/meabed/pr-commit-ai-agent/stargazers">⭐ Star us on GitHub</a> •
    <a href="https://github.com/meabed/pr-commit-ai-agent/issues">🐛 Report Bug</a> •
    <a href="https://github.com/meabed/pr-commit-ai-agent/issues">✨ Request Feature</a>
  </p>
</div>

`
