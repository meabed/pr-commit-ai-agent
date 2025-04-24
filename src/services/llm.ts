import { OpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from '../logger'
import { green, red, yellow } from 'picocolors'
import { config } from '../config'
import { type MessageParam } from '@anthropic-ai/sdk/resources/messages/messages'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { v4 as uuidv4 } from 'uuid'
import { getSystemPrompt } from './prompts'

// Define supported LLM providers
export type LLMProvider = 'openai' | 'anthropic' | 'deepseek' | 'ollama'

// Interface for chat completion options
interface CompletionOptions {
  prompt: string
  temperature?: number
  maxTokens?: number
  model?: string
  logRequest?: boolean
}

// Interface for log entry
interface LLMLogEntry {
  id: string
  timestamp: string
  provider: LLMProvider
  model: string
  options: CompletionOptions
  response?: string
  error?: string
  executionTimeMs?: number
}

// Global clients
let openaiClient: OpenAI | null = null
let anthropicClient: Anthropic | null = null

// Configuration
const logDir = path.join(os.homedir(), '.llm-logs')

// Initialize clients based on config
const initializeClients = () => {
  try {
    if (config.openai?.apiKey) {
      openaiClient = new OpenAI({
        apiKey: config.openai.apiKey,
        baseURL: config.openai.baseURL,
      })
    }

    if (config.anthropic?.apiKey) {
      anthropicClient = new Anthropic({
        apiKey: config.anthropic.apiKey,
      })
    }
  } catch (error) {
    logger.error(red(`Failed to initialize LLM clients: ${(error as Error).message}`))
  }
}

// Ensure log directory exists
const ensureLogDirectory = async (): Promise<void> => {
  try {
    await fs.mkdir(logDir, { recursive: true })
  } catch (error) {
    logger.error(red(`Failed to create log directory: ${(error as Error).message}`))
  }
}

// Log request to file
const logRequest = async (logEntry: LLMLogEntry): Promise<string> => {
  try {
    const logFileName = `llm-requests-${new Date().toISOString().split('T')[0]}.jsonl`
    const logFilePath = path.join(logDir, logFileName)

    // Create a separate JSON file for this specific request for easy manual testing
    const requestFileName = `request-${logEntry.id}.json`
    const requestFilePath = path.join(logDir, requestFileName)

    // Log the full entry to the daily log file
    await fs.appendFile(logFilePath, JSON.stringify(logEntry) + '\n', { encoding: 'utf8' })

    // Save the request part separately in a structured JSON file for easy reuse
    await fs.writeFile(requestFilePath, JSON.stringify(logEntry, null, 2), { encoding: 'utf8' })

    logger.debug(`Logged LLM request to ${logFilePath}`)
    logger.info(green(`Request saved as ${requestFilePath} (ID: ${logEntry.id})`))

    return logEntry.id
  } catch (error) {
    logger.error(red(`Failed to log LLM request: ${(error as Error).message}`))
    return logEntry.id
  }
}

// Get appropriate model for provider
const getModelForProvider = (provider: LLMProvider, customModel?: string): string => {
  switch (provider) {
    case 'openai':
      return customModel || config.openai?.defaultModel || 'gpt-3.5-turbo'
    case 'anthropic':
      return customModel || config.anthropic?.defaultModel || 'claude-3-sonnet-20240229'
    case 'deepseek':
      return customModel || config.deepseek?.defaultModel || 'deepseek-chat'
    case 'ollama':
      return customModel || config.ollama?.defaultModel || 'llama2'
    default:
      return customModel || 'unknown'
  }
}

// Provider-specific completion functions
async function openaiGenerate(options: CompletionOptions): Promise<string> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Check your API key.')
  }

  const model = options.model || config.openai?.defaultModel || 'gpt-3.5-turbo'

  logger.info(yellow(`Making OpenAI completion request with model: ${model}`))
  logger.debug(
    `OpenAI request params: temperature=${options.temperature || 0.1}, maxTokens=${options.maxTokens || 1000000}`,
  )

  const response = await openaiClient.responses.create({
    model,
    input: [
      {
        role: 'user',
        content: options.prompt,
        type: 'message',
      },
    ],
    temperature: options.temperature || 0.1,
  })

  return response.output_text || ''
}

async function anthropicGenerate(options: CompletionOptions): Promise<string> {
  if (!anthropicClient) {
    throw new Error('Anthropic client not initialized. Check your API key.')
  }

  const model = options.model || config.anthropic?.defaultModel || 'claude-3-sonnet-20240229'

  logger.info(yellow(`Making Anthropic completion request with model: ${model}`))
  logger.debug(
    `Anthropic request params: temperature=${options.temperature || 0.1}, maxTokens=${options.maxTokens || 1000000}`,
  )

  const messages = [
    {
      role: 'user',
      content: options.prompt,
    },
  ] as MessageParam[]

  const response = await anthropicClient.messages.create({
    model,
    messages,
    temperature: options.temperature || 0.1,
    max_tokens: options.maxTokens || 1000000,
    thinking: {
      type: 'disabled',
    },
  })

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  return response.content[0]?.text || ''
}

async function deepseekGenerate(options: CompletionOptions): Promise<string> {
  if (!config.deepseek?.apiKey) {
    throw new Error('DeepSeek API key not configured.')
  }

  const model = options.model || config.deepseek?.defaultModel || 'deepseek-chat'
  const apiUrl = config.deepseek?.baseURL || 'https://api.deepseek.com/v1/chat/completions'

  logger.info(yellow(`Making DeepSeek completion request with model: ${model}`))
  logger.debug(
    `DeepSeek request params: temperature=${options.temperature || 0.1}, maxTokens=${options.maxTokens || 1000000}, url=${apiUrl}`,
  )

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseek.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: options.prompt,
        },
      ],
      temperature: options.temperature || 0.1,
      max_tokens: options.maxTokens || 1000000,
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

/**
 * Configuration options for Ollama model generation requests.
 * These parameters control various aspects of the text generation process.
 */
type OllamaGenerateOptions = {
  /** Number of tokens to keep from the prompt */
  num_keep?: number
  /** Random seed for deterministic generation */
  seed?: number
  /** Maximum number of tokens to predict */
  num_predict?: number
  /** Limits the next token selection to the K most probable tokens */
  top_k?: number
  /** Limits the next token selection to a subset of tokens with a cumulative probability above a threshold P */
  top_p?: number
  /** Sets a minimum probability threshold for token selection */
  min_p?: number
  /** Controls the diversity of generated text by sampling from more probable tokens */
  typical_p?: number
  /** Number of previous tokens to consider for repetition penalty */
  repeat_last_n?: number
  /** Sampling temperature, higher values make output more random, lower more deterministic (0-1) */
  temperature?: number
  /** Penalty for repeating tokens, higher values discourage repetition */
  repeat_penalty?: number
  /** Penalty for tokens that appear in the prompt, higher values discourage them */
  presence_penalty?: number
  /** Penalty based on token's frequency in the generated text so far */
  frequency_penalty?: number
  /** Enables Mirostat sampling algorithm (0, 1, or 2) */
  mirostat?: number
  /** Mirostat target entropy parameter */
  mirostat_tau?: number
  /** Mirostat learning rate parameter */
  mirostat_eta?: number
  /** Whether to apply penalties to newline tokens */
  penalize_newline?: boolean
  /** Sequences that will cause the model to stop generating further tokens */
  stop?: string[]
  /** Whether to use NUMA optimization when available */
  numa?: boolean
  /** Size of context window in tokens */
  num_ctx?: number
  /** Batch size for token processing */
  num_batch?: number
  /** Number of GPUs to use for computation */
  num_gpu?: number
  /** Main GPU to use for computation in multi-GPU setup */
  main_gpu?: number
  /** Optimize for low VRAM usage at the cost of performance */
  low_vram?: boolean
  /** Only load the vocabulary, not the weights */
  vocab_only?: boolean
  /** Use memory mapping for the model weights */
  use_mmap?: boolean
  /** Force the system to keep the model in RAM */
  use_mlock?: boolean
  /** Number of CPU threads to use */
  num_thread?: number
}

async function ollamaGenerate(options: CompletionOptions): Promise<string> {
  const model = options.model || config.ollama?.defaultModel || 'llama2'
  const apiUrl = config.ollama?.baseURL || 'http://localhost:11434/api/generate'

  logger.info(yellow(`Making Ollama completion request with model: ${model}`))
  logger.debug(`Ollama request params: temperature=${options.temperature || 0.1}, url=${apiUrl}`)
  const body = JSON.stringify({
    model,
    stream: false,
    prompt: options.prompt,
    format: 'json',
    system: getSystemPrompt(),
    options: {
      temperature: options.temperature || 0.1, // I don't want entropy injected into my code
      num_ctx: 32768, // More useful default
      num_batch: 1024, // Faster, but more vRAM
      top_p: 0.8, // Quality
    } as OllamaGenerateOptions,
  })
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ollama.apiKey}`,
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.statusText}`)
  }

  const data = (await response.json()) as unknown as {
    response: string
  }
  return data?.response || ''
}

// Main completion function
export const generateCompletion = async (
  provider: LLMProvider,
  options: CompletionOptions,
): Promise<{ text: string; requestId: string }> => {
  logger.info(yellow(`Generating completion using ${provider}...`))

  // Ensure clients are initialized
  if (!openaiClient && !anthropicClient) {
    initializeClients()
  }

  // Ensure log directory exists
  await ensureLogDirectory()

  const startTime = Date.now()
  const model = getModelForProvider(provider, options.model)
  const requestId = uuidv4()

  const logEntry: LLMLogEntry = {
    id: requestId,
    timestamp: new Date().toISOString(),
    provider,
    model,
    options,
  }

  try {
    let response = ''

    switch (provider) {
      case 'openai':
        response = await openaiGenerate(options)
        break
      case 'anthropic':
        response = await anthropicGenerate(options)
        break
      case 'deepseek':
        response = await deepseekGenerate(options)
        break
      case 'ollama':
        response = await ollamaGenerate(options)
        break
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`)
    }

    // Update log entry with response and execution time
    logEntry.response = response
    logEntry.executionTimeMs = Date.now() - startTime

    // Only log the request if logRequest option is not explicitly false
    if (options.logRequest) {
      await logRequest(logEntry)
    }

    return { text: response, requestId }
  } catch (error) {
    // Log error case
    logEntry.error = (error as Error).message
    logEntry.executionTimeMs = Date.now() - startTime

    // Only log the error if logRequest option is not explicitly false
    if (options.logRequest) {
      await logRequest(logEntry)
    }

    logger.error(red(`Error generating completion with ${provider}: ${(error as Error).message}`))
    throw error
  }
}

// Initialize on module load
initializeClients()
ensureLogDirectory().catch((err) => logger.error(err))
