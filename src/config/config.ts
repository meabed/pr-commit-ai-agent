import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { Config } from '../types/index.js';

// Load environment variables from .env file
dotenv.config();

/**
 * Default configuration
 */
const defaultConfig: Config = {
  github: {
    token: process.env.GITHUB_TOKEN || '',
    owner: '',
    repo: '',
    baseBranch: 'main'
  },
  llm: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini'
  },
  git: {
    authorName: '',
    authorEmail: ''
  }
};

/**
 * Possible locations for config file
 */
const configLocations = [
  './.commit-pr-agentrc',
  './.commit-pr-agentrc.json',
  path.join(os.homedir(), '.commit-pr-agentrc'),
  path.join(os.homedir(), '.commit-pr-agentrc.json')
];

/**
 * Load configuration from file
 * @param configPath Optional path to config file
 * @returns Loaded configuration
 */
export function loadConfig(configPath?: string): Config {
  let config = { ...defaultConfig };
  
  // Check specified config path first
  if (configPath && fs.existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config = mergeConfigs(config, fileConfig);
    } catch (error) {
      throw new Error(`Failed to parse configuration file: ${error instanceof Error ? error.message : String(error)}`);
    }
    return config;
  }
  
  // Check default locations
  for (const location of configLocations) {
    if (fs.existsSync(location)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(location, 'utf-8'));
        config = mergeConfigs(config, fileConfig);
        break; // Use the first config file found
      } catch (error) {
        console.warn(`Failed to parse configuration file at ${location}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
  return config;
}

/**
 * Get configuration with validation
 * @param configPath Optional path to config file
 * @returns Validated configuration
 */
export function getConfig(configPath?: string): Config {
  const config = loadConfig(configPath);
  validateConfig(config);
  return config;
}

/**
 * Validate the configuration
 * @param config Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: Config): void {
  if (!config.github.token) {
    throw new Error('GitHub token is required. Set it in your config file or as GITHUB_TOKEN environment variable.');
  }
  
  if (!config.llm.apiKey) {
    throw new Error('LLM API key is required. Set it in your config file or as OPENAI_API_KEY environment variable.');
  }
  
  if (config.llm.provider === 'custom' && !config.llm.endpoint) {
    throw new Error('Endpoint URL is required for custom LLM provider.');
  }
  
  if (config.llm.provider === 'azure' && !config.llm.endpoint) {
    throw new Error('Endpoint URL is required for Azure OpenAI provider.');
  }
}

/**
 * Merge configurations
 * @param baseConfig Base configuration
 * @param overrideConfig Override configuration
 * @returns Merged configuration
 */
function mergeConfigs(baseConfig: Config, overrideConfig: Partial<Config>): Config {
  const result = { ...baseConfig };
  
  // Merge GitHub config
  if (overrideConfig.github) {
    result.github = { ...result.github, ...overrideConfig.github };
  }
  
  // Merge LLM config
  if (overrideConfig.llm) {
    result.llm = { ...result.llm, ...overrideConfig.llm };
  }
  
  // Merge Git config
  if (overrideConfig.git) {
    result.git = { ...result.git, ...overrideConfig.git };
  }
  
  return result;
}