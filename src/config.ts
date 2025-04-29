import 'dotenv/config';
import Conf from 'conf';

// Define schema for configuration with types, defaults, and validation
const schema = {
  llmProvider: {
    type: 'string',
    enum: ['openai', 'anthropic', 'deepseek', 'ollama', 'gemini'],
    default: 'openai'
  },
  model: {
    type: 'string',
    default: ''
  },
  openai: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        default: ''
      },
      baseURL: {
        type: 'string',
        format: 'uri',
        default: 'https://api.openai.com/v1'
      }
    }
  },
  anthropic: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        default: ''
      }
    }
  },
  deepseek: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        default: ''
      },
      baseURL: {
        type: 'string',
        format: 'uri',
        default: 'https://api.deepseek.com/v1'
      }
    }
  },
  ollama: {
    type: 'object',
    properties: {
      baseURL: {
        type: 'string',
        format: 'uri',
        default: 'http://localhost:11434/api/generate'
      },
      apiKey: {
        type: 'string',
        default: ''
      }
    }
  },
  gemini: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        default: ''
      }
    }
  }
};

// Create config instance with schema validation
export const configInstance = new Conf({
  projectName: 'pr-commit-ai-agent',
  schema
});

// Initialize with environment variables or use existing stored values
export function initializeConfig() {
  if (process.env.LLM_PROVIDER) {
    configInstance.set('llmProvider', process.env.LLM_PROVIDER);
  }
  if (process.env.MODEL) {
    configInstance.set('model', process.env.MODEL);
  }
  // OpenAI configuration
  if (process.env.OPENAI_API_KEY) {
    configInstance.set('openai.apiKey', process.env.OPENAI_API_KEY);
  }
  if (process.env.OPENAI_BASE_URL) {
    configInstance.set('openai.baseURL', process.env.OPENAI_BASE_URL);
  }

  // Anthropic configuration
  if (process.env.ANTHROPIC_API_KEY) {
    configInstance.set('anthropic.apiKey', process.env.ANTHROPIC_API_KEY);
  }

  // DeepSeek configuration
  if (process.env.DEEPSEEK_API_KEY) {
    configInstance.set('deepseek.apiKey', process.env.DEEPSEEK_API_KEY);
  }
  if (process.env.DEEPSEEK_BASE_URL) {
    configInstance.set('deepseek.baseURL', process.env.DEEPSEEK_BASE_URL);
  }

  // Ollama configuration
  if (process.env.OLLAMA_API_KEY) {
    configInstance.set('ollama.apiKey', process.env.OLLAMA_API_KEY);
  }
  if (process.env.OLLAMA_BASE_URL) {
    configInstance.set('ollama.baseURL', process.env.OLLAMA_BASE_URL);
  }

  // Gemini configuration
  if (process.env.GEMINI_API_KEY) {
    configInstance.set('gemini.apiKey', process.env.GEMINI_API_KEY);
  }
}

// Initialize with environment variables
initializeConfig();

// Export the entire configuration object
export const config = {
  llmProvider: configInstance.get('llmProvider') as string,
  model: configInstance.get('model') as string,
  openai: {
    apiKey: configInstance.get('openai.apiKey') as string,
    baseURL: configInstance.get('openai.baseURL') as string
  },
  anthropic: {
    apiKey: configInstance.get('anthropic.apiKey') as string
  },
  deepseek: {
    apiKey: configInstance.get('deepseek.apiKey') as string,
    baseURL: configInstance.get('deepseek.baseURL') as string
  },
  ollama: {
    baseURL: configInstance.get('ollama.baseURL') as string,
    apiKey: configInstance.get('ollama.apiKey') as string
  },
  gemini: {
    apiKey: configInstance.get('gemini.apiKey') as string
  }
};
