import { loadConfig, validateConfig } from '../config/config.js';
import { Config } from '../types/index.js';
import { jest, describe, expect, it, beforeEach, afterEach } from '@jest/globals';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn()
}));

// Import fs after mocking
import fs from 'fs';

describe('Configuration Module', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Mock environment variables
    process.env.GITHUB_TOKEN = 'mock-github-token';
    process.env.OPENAI_API_KEY = 'mock-openai-key';
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.GITHUB_TOKEN;
    delete process.env.OPENAI_API_KEY;
  });

  describe('loadConfig', () => {
    it('should load default configuration when no config file exists', () => {
      // Mock that no files exist
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const config = loadConfig();
      
      expect(config).toEqual({
        github: {
          token: 'mock-github-token',
          owner: '',
          repo: '',
          baseBranch: 'main',
        },
        llm: {
          provider: 'openai',
          apiKey: 'mock-openai-key',
          model: 'gpt-4o-mini',
        },
        git: {
          authorName: '',
          authorEmail: '',
        },
      });
    });

    it('should load configuration from specified file path', () => {
      // Mock that config file exists
      (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
        return filePath === 'custom-config.json';
      });
      
      // Mock reading the file
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        github: {
          owner: 'test-owner',
          repo: 'test-repo',
        },
        llm: {
          provider: 'azure',
          endpoint: 'https://azure-endpoint.com',
        },
      }));

      const config = loadConfig('custom-config.json');
      
      expect(config).toMatchObject({
        github: {
          token: 'mock-github-token',
          owner: 'test-owner',
          repo: 'test-repo',
          baseBranch: 'main',
        },
        llm: {
          provider: 'azure',
          apiKey: 'mock-openai-key',
          model: 'gpt-4o-mini',
          endpoint: 'https://azure-endpoint.com',
        },
      });
      
      expect(fs.readFileSync).toHaveBeenCalledWith('custom-config.json', 'utf-8');
    });

    it('should handle invalid JSON in config file', () => {
      // Mock that config file exists
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      
      // Mock reading an invalid JSON file
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid-json');

      expect(() => loadConfig('invalid-config.json')).toThrow('Failed to parse configuration file');
    });
  });

  describe('validateConfig', () => {
    it('should validate a correct configuration without errors', () => {
      const config: Config = {
        github: {
          token: 'github-token',
          owner: 'owner',
          repo: 'repo',
          baseBranch: 'main',
        },
        llm: {
          provider: 'openai',
          apiKey: 'api-key',
          model: 'gpt-4',
        },
        git: {
          authorName: 'Test Author',
          authorEmail: 'test@example.com',
        },
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should throw error when GitHub token is missing', () => {
      const config: Config = {
        github: {
          token: '',
          owner: 'owner',
          repo: 'repo',
          baseBranch: 'main',
        },
        llm: {
          provider: 'openai',
          apiKey: 'api-key',
          model: 'gpt-4',
        },
        git: {},
      };

      expect(() => validateConfig(config)).toThrow('GitHub token is required');
    });

    it('should throw error when LLM API key is missing', () => {
      const config: Config = {
        github: {
          token: 'github-token',
          owner: 'owner',
          repo: 'repo',
          baseBranch: 'main',
        },
        llm: {
          provider: 'openai',
          apiKey: '',
          model: 'gpt-4',
        },
        git: {},
      };

      expect(() => validateConfig(config)).toThrow('LLM API key is required');
    });

    it('should throw error when custom LLM provider has no endpoint', () => {
      const config: Config = {
        github: {
          token: 'github-token',
          owner: 'owner',
          repo: 'repo',
          baseBranch: 'main',
        },
        llm: {
          provider: 'custom',
          apiKey: 'api-key',
          model: 'custom-model',
        },
        git: {},
      };

      expect(() => validateConfig(config)).toThrow('Endpoint URL is required for custom LLM provider');
    });
  });
});