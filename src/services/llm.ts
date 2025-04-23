import { OpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from '../logger'
import { red, yellow } from 'picocolors'
import type { Message } from 'ai'
import { config } from '../config'
import { type MessageParam } from '@anthropic-ai/sdk/resources/messages/messages'
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions/completions'
import * as console from 'node:console'

// Define supported LLM providers
export type LLMProvider = 'openai' | 'anthropic' | 'deepseek' | 'ollama'

// Interface for chat completion options
interface CompletionOptions {
  messages: Message[]
  temperature?: number
  maxTokens?: number
  model?: string
}

export class LLMService {
  private openaiClient: OpenAI | null = null
  private anthropicClient: Anthropic | null = null

  // For DeepSeek and Ollama, we'll use fetch API directly

  constructor() {
    this.initializeClients()
  }

  private initializeClients() {
    try {
      if (config.openai?.apiKey) {
        this.openaiClient = new OpenAI({
          apiKey: config.openai.apiKey,
          baseURL: config.openai.baseURL,
        })
      }

      if (config.anthropic?.apiKey) {
        this.anthropicClient = new Anthropic({
          apiKey: config.anthropic.apiKey,
        })
      }
    } catch (error) {
      logger.error(red(`Failed to initialize LLM clients: ${(error as Error).message}`))
    }
  }

  async generateCompletion(provider: LLMProvider, options: CompletionOptions): Promise<string> {
    logger.info(yellow(`Generating completion using ${provider}...`))

    try {
      switch (provider) {
        case 'openai':
          return await this.openaiCompletion(options)
        case 'anthropic':
          return await this.anthropicCompletion(options)
        case 'deepseek':
          return await this.deepseekCompletion(options)
        case 'ollama':
          return await this.ollamaCompletion(options)
        default:
          throw new Error(`Unsupported LLM provider: ${provider}`)
      }
    } catch (error) {
      logger.error(red(`Error generating completion with ${provider}: ${(error as Error).message}`))
      throw error
    }
  }

  private async openaiCompletion(options: CompletionOptions): Promise<string> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized. Check your API key.')
    }

    const model = options.model || config.openai?.defaultModel || 'gpt-3.5-turbo'

    const response = await this.openaiClient.chat.completions.create({
      model,
      messages: options.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })) as ChatCompletionMessageParam[],
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 1000,
    })

    return response.choices[0]?.message?.content || ''
  }

  private async anthropicCompletion(options: CompletionOptions): Promise<string> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized. Check your API key.')
    }

    const model = options.model || config.anthropic?.defaultModel || 'claude-3-sonnet-20240229'

    const messages = options.messages.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })) as MessageParam[]

    const response = await this.anthropicClient.messages.create({
      model,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 1000,
      thinking: {
        type: 'disabled',
      },
    })

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    return response.content[0]?.text || ''
  }

  private async deepseekCompletion(options: CompletionOptions): Promise<string> {
    if (!config.deepseek?.apiKey) {
      throw new Error('DeepSeek API key not configured.')
    }

    const model = options.model || config.deepseek?.defaultModel || 'deepseek-chat'
    const apiUrl = config.deepseek?.baseURL || 'https://api.deepseek.com/v1/chat/completions'

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: options.temperature || 0.7,
        max_tokens: options.maxTokens || 1000,
      }),
    })

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.statusText}`)
    }

    const data = (await response.json()) as unknown as {
      choices: {
        message: {
          content: string
        }
      }[]
    }
    return data.choices[0]?.message?.content || ''
  }

  private async ollamaCompletion(options: CompletionOptions): Promise<string> {
    const model = options.model || config.ollama?.defaultModel || 'llama2'
    const apiUrl = config.ollama?.baseURL || 'http://localhost:11434/api/chat'

    console.log('Ollama API URL:', config.ollama)

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ollama.apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: options.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        options: {
          temperature: options.temperature || 0.7,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`)
    }

    const data = (await response.json()) as unknown as {
      message: {
        content: string
      }
    }
    return data.message?.content || ''
  }
}

// Export a singleton instance
export const llmService = new LLMService()
