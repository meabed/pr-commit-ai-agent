import { LLMService } from '../services/llm.service.js';
import { Config, GitChanges } from '../types/index.js';
import { jest, describe, expect, it, beforeEach } from '@jest/globals';

// Mock OpenAI responses
const mockOpenAICreate = jest.fn().mockResolvedValue({
  choices: [
    {
      message: {
        content: JSON.stringify({
          commitMessage: 'Test commit message',
          prTitle: 'Test PR title',
          prDescription: 'Test PR description'
        })
      }
    }
  ]
});

// Mock OpenAI constructor
jest.mock('openai', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockOpenAICreate
        }
      }
    }))
  };
});

// Mock axios
jest.mock('axios', () => ({
  post: jest.fn()
}));

// Import dependencies after mocking
import OpenAI from 'openai';
import axios from 'axios';

describe('LLMService', () => {
  let service: LLMService;
  let mockConfig: Config;
  let mockChanges: GitChanges;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock config for testing
    mockConfig = {
      github: {
        token: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
        baseBranch: 'main'
      },
      llm: {
        provider: 'openai',
        apiKey: 'test-api-key',
        model: 'gpt-4',
      },
      git: {}
    };
    
    // Mock git changes
    mockChanges = {
      changedFiles: ['test.js', 'README.md'],
      diff: 'test diff content',
      branch: 'feature-branch',
      uncommittedChanges: true,
      unpushedCommits: []
    };
    
    // Create service instance
    service = new LLMService(mockConfig);
  });

  describe('OpenAI provider', () => {
    it('should generate change summary using OpenAI', async () => {
      const result = await service.generateChangeSummary(mockChanges);
      
      expect(result).toEqual({
        commitMessage: 'Test commit message',
        prTitle: 'Test PR title',
        prDescription: 'Test PR description'
      });
      
      // Check if OpenAI was initialized correctly
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key'
      });
      
      // Check if OpenAI API was called correctly
      expect(mockOpenAICreate).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: [{ role: 'user', content: expect.stringContaining('test diff content') }],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      });
    });
    
    it('should handle errors from OpenAI', async () => {
      // Mock OpenAI to throw an error
      mockOpenAICreate.mockRejectedValueOnce(new Error('OpenAI API error'));
      
      await expect(service.generateChangeSummary(mockChanges)).rejects.toThrow();
    });
    
    it('should handle invalid JSON responses from OpenAI', async () => {
      // Mock OpenAI to return invalid JSON
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'invalid json' } }]
      });
      
      await expect(service.generateChangeSummary(mockChanges)).rejects.toThrow('Failed to parse response from OpenAI');
    });
  });
  
  describe('Azure provider', () => {
    beforeEach(() => {
      // Set up config for Azure
      mockConfig.llm.provider = 'azure';
      mockConfig.llm.endpoint = 'https://azure-endpoint.com';
      service = new LLMService(mockConfig);
      
      // Mock axios response
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: {
                  commitMessage: 'Azure commit message',
                  prTitle: 'Azure PR title',
                  prDescription: 'Azure PR description'
                }
              }
            }
          ]
        }
      });
    });
    
    it('should generate change summary using Azure', async () => {
      await service.generateChangeSummary(mockChanges);
      
      expect(axios.post).toHaveBeenCalledWith(
        'https://azure-endpoint.com',
        expect.objectContaining({
          messages: [{ role: 'user', content: expect.stringContaining('test diff content') }],
          model: 'gpt-4'
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'api-key': 'test-api-key'
          })
        })
      );
    });
    
    it('should throw error when endpoint is not specified', async () => {
      mockConfig.llm.endpoint = undefined;
      service = new LLMService(mockConfig);
      
      await expect(service.generateChangeSummary(mockChanges)).rejects.toThrow('Azure OpenAI endpoint not specified');
    });
  });
  
  describe('Anthropic provider', () => {
    beforeEach(() => {
      // Set up config for Anthropic
      mockConfig.llm.provider = 'anthropic';
      service = new LLMService(mockConfig);
      
      // Mock axios response
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          content: [{ text: JSON.stringify({
            commitMessage: 'Anthropic commit message',
            prTitle: 'Anthropic PR title',
            prDescription: 'Anthropic PR description'
          })}]
        }
      });
    });
    
    it('should generate change summary using Anthropic', async () => {
      const result = await service.generateChangeSummary(mockChanges);
      
      expect(result).toEqual({
        commitMessage: 'Anthropic commit message',
        prTitle: 'Anthropic PR title',
        prDescription: 'Anthropic PR description'
      });
      
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          model: 'gpt-4',
          messages: [{ role: 'user', content: expect.stringContaining('test diff content') }]
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'test-api-key'
          })
        })
      );
    });
  });
  
  describe('Custom provider', () => {
    beforeEach(() => {
      // Set up config for custom provider
      mockConfig.llm.provider = 'custom';
      mockConfig.llm.endpoint = 'https://custom-llm-endpoint.com';
      service = new LLMService(mockConfig);
      
      // Mock axios response
      (axios.post as jest.Mock).mockResolvedValue({
        data: {
          commitMessage: 'Custom commit message',
          prTitle: 'Custom PR title',
          prDescription: 'Custom PR description'
        }
      });
    });
    
    it('should generate change summary using custom provider', async () => {
      const result = await service.generateChangeSummary(mockChanges);
      
      expect(result).toEqual({
        commitMessage: 'Custom commit message',
        prTitle: 'Custom PR title',
        prDescription: 'Custom PR description'
      });
      
      expect(axios.post).toHaveBeenCalledWith(
        'https://custom-llm-endpoint.com',
        { prompt: expect.stringContaining('test diff content') },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );
    });
    
    it('should throw error when endpoint is not specified', async () => {
      mockConfig.llm.endpoint = undefined;
      service = new LLMService(mockConfig);
      
      await expect(service.generateChangeSummary(mockChanges)).rejects.toThrow('Custom LLM endpoint not specified');
    });
  });
  
  describe('Unsupported provider', () => {
    it('should throw error for unsupported provider', async () => {
      mockConfig.llm.provider = 'unsupported' as any;
      service = new LLMService(mockConfig);
      
      await expect(service.generateChangeSummary(mockChanges)).rejects.toThrow('Unsupported LLM provider');
    });
  });
});