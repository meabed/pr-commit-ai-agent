# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GGPR (pr-commit-ai-agent) is an AI-powered CLI tool that enhances Git workflows by generating commit messages, branch names, and pull requests using various LLM providers (OpenAI, Anthropic, Ollama, DeepSeek, Gemini).

## Development Commands

### Build & Development
```bash
bun run build       # Build the project using Bun
bun run build:watch # Build with watch mode
bun run compile     # Type-check using TypeScript compiler
bun run clean       # Clean dist directory
```

### Testing
```bash
bun test            # Run tests with Bun's built-in test runner
bun test --watch    # Run tests in watch mode
```

### Code Quality
```bash
bun run lint        # Run Biome linting
bun run lint:fix    # Fix Biome linting issues
bun run format      # Check Biome formatting
bun run format:fix  # Fix formatting issues
bun run check       # Run all Biome checks (lint + format)
bun run check:fix   # Fix all Biome issues
```

### Running the CLI
```bash
bun start           # Run using Bun (development)
bun run start:node  # Run using node (production)
./bin/run           # Direct execution
ggpr                # Global command (after installation)
```

## Architecture

### Entry Points
- `bin/run` - Main CLI entry point that loads commands
- `src/index.ts` - Exports all commands

### Core Modules

#### Commands (`src/commands/`)
- `create.ts` - Main command for creating commits and PRs with AI assistance
- `info.ts` - Display repository information
- `config.ts` - Manage configuration settings
- `logs.ts` - View LLM request logs

#### Services (`src/services/`)
- `llm.ts` - Multi-provider LLM integration (OpenAI, Anthropic, Ollama, DeepSeek, Gemini)
- `prompts.ts` - System prompts for AI interactions

#### Core Files
- `src/config.ts` - Configuration management using `conf` package
- `src/logger.ts` - Logging utilities using `consola`

### Key Dependencies
- **CLI Framework**: `yargs` for command parsing
- **Git Operations**: `simple-git` for Git interactions
- **LLM Providers**: Multiple SDKs (`openai`, `@anthropic-ai/sdk`, `@ai-sdk/google`, `ollama-ai-provider`)
- **Process Management**: `execa` for subprocess execution
- **Configuration**: `conf` for persistent settings

### Build Configuration
- **Runtime**: Bun - all-in-one JavaScript runtime and toolkit
- **TypeScript**: Node 20 target with strict type checking
- **Bundler**: Bun's built-in bundler (configured in `build.ts`)
- **Testing**: Bun's built-in test runner (migrated from Jest)
- **Linting/Formatting**: Biome - all-in-one linter and formatter (replaces ESLint + Prettier)
- **Package Manager**: Bun (v1.1.42)

## Workflow Implementation

The `create` command implements a sophisticated workflow:
1. Determine target branch (tracking or user-selected)
2. Handle uncommitted changes with AI-generated commit messages
3. Optimize existing commit messages using AI
4. Create/update branches with AI-generated names
5. Generate and create PRs via GitHub CLI integration

## Configuration Storage

User configuration is stored via the `conf` package in platform-specific locations:
- macOS: `~/Library/Preferences/pr-commit-ai-agent-nodejs/`
- Linux: `~/.config/pr-commit-ai-agent-nodejs/`
- Windows: `%APPDATA%/pr-commit-ai-agent-nodejs/`

## LLM Integration

The `llm.ts` service provides a unified interface for multiple providers:
- Supports streaming and non-streaming responses
- Includes cost estimation via `llm-cost` package
- Logs all requests to `~/.pr-commit-ai-agent/logs/` for debugging
- Handles provider-specific configurations (API keys, base URLs, models)