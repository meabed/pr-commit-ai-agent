import OpenAI from 'openai';
import axios from 'axios';
import { Config, LLMResult, GitChanges } from '../types/index.js';

/**
 * Service for interacting with LLMs
 */
export class LLMService {
  private config: Config;
  private openai?: OpenAI;
  
  /**
   * Create a new LLMService
   * @param config Configuration for the LLM
   */
  constructor(config: Config) {
    this.config = config;
    
    if (config.llm.provider === 'openai') {
      this.openai = new OpenAI({
        apiKey: config.llm.apiKey
      });
    }
  }
  
  /**
   * Generate a summary of changes using the LLM
   * @param changes Git changes to summarize
   * @returns Generated summary
   */
  async generateChangeSummary(changes: GitChanges): Promise<LLMResult> {
    const { diff, changedFiles } = changes;
    
    // Create a prompt for the LLM
    const prompt = this.createPrompt(diff, changedFiles);
    
    switch (this.config.llm.provider) {
      case 'openai':
        return this.generateWithOpenAI(prompt);
      case 'azure':
        return this.generateWithAzure(prompt);
      case 'anthropic':
        return this.generateWithAnthropic(prompt);
      case 'custom':
        return this.generateWithCustomLLM(prompt);
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.llm.provider}`);
    }
  }
  
  /**
   * Create a prompt for the LLM
   * @param diff Git diff content
   * @param changedFiles List of changed files
   * @returns Formatted prompt
   */
  private createPrompt(diff: string, changedFiles: string[]): string {
    return `
You are an expert developer reviewing code changes. Analyze the following git diff and generate:
1. A concise and descriptive commit message (first line should be a summary, followed by details)
2. A suitable pull request title
3. A comprehensive pull request description that explains the changes, their purpose, and any important details

Changed files:
${changedFiles.map(file => `- ${file}`).join('\n')}

Git diff:
\`\`\`diff
${diff}
\`\`\`

Format your response as a JSON object with the following structure:
{
  "commitMessage": "...",
  "prTitle": "...",
  "prDescription": "..."
}
`;
  }
  
  /**
   * Generate summary using OpenAI
   * @param prompt Prompt for the LLM
   * @returns Generated summary
   */
  private async generateWithOpenAI(prompt: string): Promise<LLMResult> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }
    
    const response = await this.openai.chat.completions.create({
      model: this.config.llm.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });
    
    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No content in response from OpenAI');
    }
    
    try {
      return JSON.parse(content) as LLMResult;
    } catch (error) {
      throw new Error(`Failed to parse response from OpenAI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Generate summary using Azure OpenAI
   * @param prompt Prompt for the LLM
   * @returns Generated summary
   */
  private async generateWithAzure(prompt: string): Promise<LLMResult> {
    if (!this.config.llm.endpoint) {
      throw new Error('Azure OpenAI endpoint not specified');
    }
    
    try {
      const response = await axios.post(
        this.config.llm.endpoint,
        {
          messages: [{ role: 'user', content: prompt }],
          model: this.config.llm.model,
          temperature: 0.7,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.config.llm.apiKey
          }
        }
      );
      
      return response.data.choices[0].message.content;
    } catch (error) {
      throw new Error(`Azure OpenAI API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Generate summary using Anthropic
   * @param prompt Prompt for the LLM
   * @returns Generated summary
   */
  private async generateWithAnthropic(prompt: string): Promise<LLMResult> {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: this.config.llm.model,
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
          system: "You are an expert developer analyzing code changes to generate helpful summaries."
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.llm.apiKey,
            'anthropic-version': '2023-06-01'
          }
        }
      );
      
      const content = response.data.content[0].text;
      try {
        return JSON.parse(content) as LLMResult;
      } catch (error) {
        throw new Error(`Failed to parse response from Anthropic: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      throw new Error(`Anthropic API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Generate summary using custom LLM endpoint
   * @param prompt Prompt for the LLM
   * @returns Generated summary
   */
  private async generateWithCustomLLM(prompt: string): Promise<LLMResult> {
    if (!this.config.llm.endpoint) {
      throw new Error('Custom LLM endpoint not specified');
    }
    
    try {
      const response = await axios.post(
        this.config.llm.endpoint,
        { prompt },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.llm.apiKey}`
          }
        }
      );
      
      return response.data;
    } catch (error) {
      throw new Error(`Custom LLM API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}