import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { green, red, yellow } from 'picocolors';
import { config } from '../config';
import { type MessageParam } from '@anthropic-ai/sdk/resources/messages/messages';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import { getSystemPrompt } from './prompts';
import { tokenizeAndEstimateCost } from 'llm-cost';
import { createGoogleGenerativeAI, GoogleGenerativeAIProvider } from '@ai-sdk/google';
import { generateObject, GenerateObjectResult, jsonSchema } from 'ai';

// Types and Interfaces
export type LLMProvider = 'openai' | 'anthropic' | 'deepseek' | 'ollama' | 'gemini';

export interface CompletionOptions {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  logRequest?: boolean;
}

interface LLMLogEntry {
  id: string;
  timestamp: string;
  provider: LLMProvider;
  model: string;
  options: CompletionOptions;
  response?: unknown;
  text?: string;
  error?: string;
  executionTimeMs?: number;
  tokenUsage?: LLMCostEstimate;
}

/**
 * Configuration options for Ollama model generation requests.
 * These parameters control various aspects of the text generation process.
 */
type OllamaGenerateOptions = {
  /** Number of tokens to keep from the prompt */
  num_keep?: number;
  /** Random seed for deterministic generation */
  seed?: number;
  /** Maximum number of tokens to predict */
  num_predict?: number;
  /** Limits the next token selection to the K most probable tokens */
  top_k?: number;
  /** Limits the next token selection to a subset of tokens with a cumulative probability above a threshold P */
  top_p?: number;
  /** Sets a minimum probability threshold for token selection */
  min_p?: number;
  /** Controls the diversity of generated text by sampling from more probable tokens */
  typical_p?: number;
  /** Number of previous tokens to consider for repetition penalty */
  repeat_last_n?: number;
  /** Sampling temperature, higher values make output more random, lower more deterministic (0-1) */
  temperature?: number;
  /** Penalty for repeating tokens, higher values discourage repetition */
  repeat_penalty?: number;
  /** Penalty for tokens that appear in the prompt, higher values discourage them */
  presence_penalty?: number;
  /** Penalty based on token's frequency in the generated text so far */
  frequency_penalty?: number;
  /** Enables Mirostat sampling algorithm (0, 1, or 2) */
  mirostat?: number;
  /** Mirostat target entropy parameter */
  mirostat_tau?: number;
  /** Mirostat learning rate parameter */
  mirostat_eta?: number;
  /** Whether to apply penalties to newline tokens */
  penalize_newline?: boolean;
  /** Sequences that will cause the model to stop generating further tokens */
  stop?: string[];
  /** Whether to use NUMA optimization when available */
  numa?: boolean;
  /** Size of a context window in tokens */
  num_ctx?: number;
  /** Batch size for token processing */
  num_batch?: number;
  /** Number of GPUs to use for computation */
  num_gpu?: number;
  /** Main GPU to use for computation in multi-GPU setup */
  main_gpu?: number;
  /** Optimize for low VRAM usage at the cost of performance */
  low_vram?: boolean;
  /** Only load the vocabulary, not the weights */
  vocab_only?: boolean;
  /** Use memory mapping for the model weights */
  use_mmap?: boolean;
  /** Force the system to keep the model in RAM */
  use_mlock?: boolean;
  /** Number of CPU threads to use */
  num_thread?: number;
};

// Clients and configuration
let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let geminiClient: GoogleGenerativeAIProvider | null = null;
export const logDir = path.join(os.homedir(), '.llm-logs');

/**
 * Initialize LLM clients based on available API keys in config
 */
function initializeClients(): void {
  try {
    if (config.openai?.apiKey) {
      openaiClient = new OpenAI({
        apiKey: config.openai.apiKey,
        baseURL: config.openai.baseURL
      });
      logger.debug('OpenAI client initialized successfully');
    } else {
      logger.debug('Skipping OpenAI client initialization: No API key provided');
    }

    if (config.anthropic?.apiKey) {
      anthropicClient = new Anthropic({
        apiKey: config.anthropic.apiKey
      });
      logger.debug('Anthropic client initialized successfully');
    } else {
      logger.debug('Skipping Anthropic client initialization: No API key provided');
    }

    if (config.gemini?.apiKey) {
      geminiClient = createGoogleGenerativeAI({
        apiKey: config.gemini.apiKey
      });

      logger.debug('Google Gemini client initialized successfully');
    } else {
      logger.debug('Skipping Google Gemini client initialization: No API key provided');
    }
  } catch (error) {
    logger.error(red(`Failed to initialize LLM clients: ${(error as Error).message}`));
    throw new Error(`LLM client initialization failed: ${(error as Error).message}`);
  }
}

/**
 * Ensure the log directory exists for storing LLM request logs
 */
async function ensureLogDirectory(): Promise<void> {
  try {
    await fs.mkdir(logDir, { recursive: true });
    logger.debug(`LLM log directory ensured at: ${logDir}`);
  } catch (error) {
    logger.error(red(`Failed to create log directory: ${(error as Error).message}`));
    throw new Error(`Log directory creation failed: ${(error as Error).message}`);
  }
}

/**
 * Log an LLM request to a file system for later reference
 *
 * @param logEntry The log entry to write
 * @returns The request ID of the logged entry
 */
async function logRequest(logEntry: LLMLogEntry): Promise<string> {
  try {
    // Create a separate JSON file for this specific request for easy manual testing
    const requestFileName = `request-${new Date().toISOString().split('T')[0]}-${logEntry.id}.json`;
    const requestFilePath = path.join(logDir, requestFileName);

    // Save the request part separately in a structured JSON file for easy reuse
    await fs.writeFile(requestFilePath, JSON.stringify(logEntry, null, 2), { encoding: 'utf8' });

    logger.info(green(`Request saved as ${requestFilePath} (ID: ${logEntry.id})`));

    return logEntry.id;
  } catch (error) {
    logger.error(red(`Failed to log LLM request: ${(error as Error).message}`));
    return logEntry.id;
  }
}

/**
 * Get the default model for a specific LLM provider
 *
 * @param provider The LLM provider
 * @param customModel Optional custom model to override the default
 * @returns The model name to use
 */
function getModelForProvider(provider: LLMProvider, customModel?: string): string {
  if (customModel) return customModel;

  switch (provider) {
    case 'openai':
      return config.model || 'gpt-3.5-turbo';
    case 'anthropic':
      return config.model || 'claude-3-sonnet-20240229';
    case 'deepseek':
      return config.model || 'deepseek-chat';
    case 'ollama':
      return config.model || 'llama2';
    case 'gemini':
      return config.model || 'gemini-1.5-pro';
    default:
      return 'unknown';
  }
}

type LLMCostEstimate = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number;
};

/**
 * Log token count and estimated cost information
 *
 * @param model The model being used
 * @param input The input prompt
 * @param output Optional output text
 * @returns The token usage information or undefined if calculation fails
 */
async function logTokensAndCost(model: string, input: string, output?: string): Promise<LLMCostEstimate | undefined> {
  try {
    // If output is provided, log combined input/output tokens and cost
    if (output) {
      const inputOutputCost = await tokenizeAndEstimateCost({
        model,
        input,
        output
      });

      logger.info(
        yellow(
          `Input tokens: ${inputOutputCost.inputTokens}, Output tokens: ${inputOutputCost.outputTokens}, Cost: ${inputOutputCost.cost}`
        )
      );

      return {
        inputTokens: inputOutputCost.inputTokens,
        outputTokens: inputOutputCost.outputTokens,
        totalTokens: inputOutputCost.inputTokens + inputOutputCost.outputTokens,
        cost: inputOutputCost.cost
      };
    }
    // Log input tokens
    const inputToken = await tokenizeAndEstimateCost({
      model,
      input
    });
    logger.info(yellow(`Input tokens: ${inputToken.inputTokens}`));

    return {
      inputTokens: inputToken.inputTokens,
      outputTokens: 0,
      totalTokens: inputToken.inputTokens,
      cost: inputToken.cost
    };
  } catch (error) {
    logger.warn(yellow(`Failed to calculate token usage: ${(error as Error).message}`));
    return undefined;
  }
}

/**
 * Generate a completion using OpenAI
 */
async function openaiGenerate(options: CompletionOptions): Promise<{ text: string; tokenUsage?: LLMCostEstimate }> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized. Check your API key.');
  }

  const model = options.model || config.model || 'gpt-3.5-turbo';
  logger.info(yellow(`Making OpenAI completion request with model: ${model}`));

  // Log input tokens
  await logTokensAndCost(model, options.prompt);

  logger.debug(
    `OpenAI request params: temperature=${options.temperature || 0.1}, maxTokens=${options.maxTokens || 1000000}`
  );

  try {
    const response = await openaiClient.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: options.prompt,
          type: 'message'
        }
      ],
      temperature: options.temperature || 0.1
    });

    const outputText = response.output_text || '';

    // Log combined input/output tokens and cost
    const tokenUsage = await logTokensAndCost(model, options.prompt, outputText);

    return { text: outputText, tokenUsage };
  } catch (error) {
    throw new Error(`OpenAI API error: ${(error as Error).message}`);
  }
}

/**
 * Generate a completion using Anthropic
 */
async function anthropicGenerate(options: CompletionOptions): Promise<{ text: string; tokenUsage?: LLMCostEstimate }> {
  if (!anthropicClient) {
    throw new Error('Anthropic client not initialized. Check your API key.');
  }

  const model = options.model || config.model || 'claude-3-sonnet-20240229';
  logger.info(yellow(`Making Anthropic completion request with model: ${model}`));

  // Log input tokens
  await logTokensAndCost(model, options.prompt);

  logger.debug(
    `Anthropic request params: temperature=${options.temperature || 0.1}, maxTokens=${options.maxTokens || 1000000}`
  );

  try {
    const messages = [
      {
        role: 'user',
        content: options.prompt
      }
    ] as MessageParam[];

    const response = await anthropicClient.messages.create({
      model,
      messages,
      temperature: options.temperature || 0.1,
      max_tokens: options.maxTokens || 1000000,
      thinking: {
        type: 'disabled'
      }
    });

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const responseText = response.content[0]?.text || '';

    // Log combined input/output tokens and cost
    const tokenUsage = await logTokensAndCost(model, options.prompt, responseText);

    return { text: responseText, tokenUsage };
  } catch (error) {
    throw new Error(`Anthropic API error: ${(error as Error).message}`);
  }
}

/**
 * Generate a completion using DeepSeek
 */
async function deepseekGenerate(options: CompletionOptions): Promise<{ text: string; tokenUsage?: LLMCostEstimate }> {
  if (!config.deepseek?.apiKey) {
    throw new Error('DeepSeek API key not configured.');
  }

  const model = options.model || config.model || 'deepseek-chat';
  const apiUrl = config.deepseek?.baseURL || 'https://api.deepseek.com/v1/chat/completions';

  logger.info(yellow(`Making DeepSeek completion request with model: ${model}`));

  // Log input tokens
  await logTokensAndCost(model, options.prompt);

  logger.debug(
    `DeepSeek request params: temperature=${options.temperature || 0.1}, maxTokens=${options.maxTokens || 1000000}, url=${apiUrl}`
  );

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: options.prompt
          }
        ],
        temperature: options.temperature || 0.1,
        max_tokens: options.maxTokens || 1000000
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as unknown as {
      choices: {
        message: {
          content: string;
        };
      }[];
    };

    if (!data || !data.choices || !data.choices[0]?.message) {
      throw new Error('Invalid response format from DeepSeek API');
    }

    const responseText = data.choices[0].message.content || '';

    // Log combined input/output tokens and cost
    const tokenUsage = await logTokensAndCost(model, options.prompt, responseText);

    return { text: responseText, tokenUsage };
  } catch (error) {
    throw new Error(`DeepSeek API error: ${(error as Error).message}`);
  }
}

/**
 * Generate a completion using Ollama
 */
async function ollamaGenerate(
  options: CompletionOptions
): Promise<{ response: unknown; text: string; tokenUsage?: LLMCostEstimate }> {
  const model = options.model || config.model || 'llama2';
  const apiUrl = config.ollama?.baseURL || 'http://localhost:11434/api/generate';

  logger.info(yellow(`Making Ollama completion request with model: ${model}`));

  // Log input tokens
  await logTokensAndCost(model, options.prompt);

  logger.debug(`Ollama request params: temperature=${options.temperature || 0.1}, url=${apiUrl}`);

  try {
    const body = JSON.stringify({
      model,
      stream: false,
      prompt: options.prompt,
      format: 'json',
      // system: '',
      options: {
        temperature: options.temperature || 0.1,
        num_ctx: 32768,
        // num_batch: 8,
        top_p: 0.8
      } as OllamaGenerateOptions
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add authorization header if API key is configured
    if (config.ollama?.apiKey) {
      headers.Authorization = `Bearer ${config.ollama.apiKey}`;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as unknown as { response?: string };

    if (!data || typeof data !== 'object' || !('response' in data)) {
      throw new Error('Invalid response format from Ollama API');
    }

    const responseText = data.response || '';

    // Log combined input/output tokens and cost
    const tokenUsage = await logTokensAndCost(model, options.prompt, responseText);

    return { response: data, text: responseText, tokenUsage };
  } catch (error) {
    throw new Error(`Ollama API error: ${(error as Error).message}`);
  }
}

/**
 * Generate a completion using Google Gemini
 */
async function geminiGenerate(options: CompletionOptions): Promise<{
  response: GenerateObjectResult<unknown>;
  text: string;
  tokenUsage: LLMCostEstimate | undefined;
}> {
  if (!geminiClient) {
    throw new Error('Gemini client not initialized. Check your API key.');
  }

  const model = options.model || config.model || 'gemini-1.5-pro';
  logger.info(yellow(`Making Gemini completion request with model: ${model}`));

  // Log input tokens
  await logTokensAndCost(model, options.prompt);

  logger.debug(`Gemini request params: temperature=${options.temperature || 0.1}, model=${model}`);

  try {
    // Get the generative model
    const response = await generateObject({
      model: geminiClient(model, {
        structuredOutputs: true
      }),
      schema: jsonSchema({
        type: 'object'
      }),
      prompt: options.prompt,
      temperature: options.temperature || 0.1
    });

    const object = response.object ?? {};
    // Log combined input/output tokens and cost
    const tokenUsage = await logTokensAndCost(model, options.prompt, JSON.stringify(object));

    return { response, text: JSON.stringify(object), tokenUsage };
  } catch (error) {
    throw new Error(`Gemini API error: ${(error as Error).message}`);
  }
}

/**
 * Main completion function to generate text from any supported LLM provider
 *
 * @param provider The LLM provider to use
 * @param options Completion options including prompt, temperature, etc.
 * @returns The generated text and a unique request ID
 */
export const generateCompletion = async (
  provider: LLMProvider,
  options: CompletionOptions
): Promise<{ response: unknown; text: string; requestId: string }> => {
  logger.info(yellow(`Generating completion using ${provider}...`));

  // Ensure clients are initialized
  if (!openaiClient && !anthropicClient && !geminiClient) {
    initializeClients();
  }

  // Ensure log directory exists
  await ensureLogDirectory().catch((err) => {
    logger.warn(yellow(`Failed to ensure log directory, but will continue: ${err.message}`));
  });

  const startTime = Date.now();
  const model = getModelForProvider(provider, options.model);
  const requestId = uuidv4();

  options.prompt = getSystemPrompt() + options.prompt;

  const logEntry: LLMLogEntry = {
    id: requestId,
    timestamp: new Date().toISOString(),
    provider,
    model,
    options: { ...options }
  };

  try {
    let response: unknown = {};
    let text = '';
    let tokenUsage;

    switch (provider) {
      case 'openai': {
        const openaiResult = await openaiGenerate(options);
        response = openaiResult.text;
        text = openaiResult.text;
        tokenUsage = openaiResult.tokenUsage;
        break;
      }
      case 'anthropic': {
        const anthropicResult = await anthropicGenerate(options);
        response = anthropicResult.text;
        text = anthropicResult.text;
        tokenUsage = anthropicResult.tokenUsage;
        break;
      }
      case 'deepseek': {
        const deepseekResult = await deepseekGenerate(options);
        response = deepseekResult.text;
        text = deepseekResult.text;
        tokenUsage = deepseekResult.tokenUsage;
        break;
      }
      case 'ollama': {
        const ollamaResult = await ollamaGenerate(options);
        response = ollamaResult.response;
        text = ollamaResult.text;
        tokenUsage = ollamaResult.tokenUsage;
        break;
      }
      case 'gemini': {
        const geminiResult = await geminiGenerate(options);
        response = geminiResult.response;
        text = geminiResult.text;
        tokenUsage = geminiResult.tokenUsage;
        break;
      }
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }

    // Update log entry with response, execution time, and token usage
    logEntry.response = response;
    logEntry.text = text;
    logEntry.executionTimeMs = Date.now() - startTime;

    if (tokenUsage) {
      logEntry.tokenUsage = {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        cost: tokenUsage.cost
      };
    }

    // Only log the request if the logRequest option is true
    if (options.logRequest) {
      await logRequest(logEntry).catch((err) => {
        logger.warn(yellow(`Failed to log request, but will continue: ${err.message}`));
      });
    }

    return { text: text, response, requestId };
  } catch (error) {
    // Log error case
    logEntry.error = (error as Error).message;
    logEntry.executionTimeMs = Date.now() - startTime;

    // Only log the error if the logRequest option is true
    if (options.logRequest) {
      await logRequest(logEntry).catch((err) => {
        logger.warn(yellow(`Failed to log error request, but will continue: ${err.message}`));
      });
    }

    logger.error(red(`Error generating completion with ${provider}: ${(error as Error).message}`));
    throw error;
  }
};

// Initialize on module load
initializeClients();
ensureLogDirectory().catch((err) => logger.error(red(`Log directory initialization error: ${err.message}`)));
