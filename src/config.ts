import 'dotenv/config';
import Conf from 'conf';

// Define schema for configuration with types, defaults, and validation
const schema = {
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
      },
      defaultModel: {
        type: 'string',
        default: 'gpt-3.5-turbo'
      }
    }
  },
  anthropic: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        default: ''
      },
      defaultModel: {
        type: 'string',
        default: 'claude-3-sonnet-20240229'
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
      },
      defaultModel: {
        type: 'string',
        default: 'deepseek-chat'
      }
    }
  },
  ollama: {
    type: 'object',
    properties: {
      baseURL: {
        type: 'string',
        format: 'uri',
        default: 'http://localhost:11434/api/chat'
      },
      apiKey: {
        type: 'string',
        default: ''
      },
      defaultModel: {
        type: 'string',
        default: 'llama2'
      }
    }
  }
};

// Create config instance with schema validation
const configInstance = new Conf({
  projectName: 'pr-commit-ai-agent',
  schema
});

// Initialize with environment variables or use existing stored values
function initializeConfig() {
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
  if (process.env.OLLAMA_DEFAULT_MODEL) {
    configInstance.set('ollama.defaultModel', process.env.OLLAMA_DEFAULT_MODEL);
  }
}

// Initialize with environment variables
initializeConfig();

// Export the entire configuration object
export const config = {
  openai: {
    apiKey: configInstance.get('openai.apiKey') as string,
    baseURL: configInstance.get('openai.baseURL') as string,
    defaultModel: configInstance.get('openai.defaultModel') as string
  },
  anthropic: {
    apiKey: configInstance.get('anthropic.apiKey') as string,
    defaultModel: configInstance.get('anthropic.defaultModel') as string
  },
  deepseek: {
    apiKey: configInstance.get('deepseek.apiKey') as string,
    baseURL: configInstance.get('deepseek.baseURL') as string,
    defaultModel: configInstance.get('deepseek.defaultModel') as string
  },
  ollama: {
    baseURL: configInstance.get('ollama.baseURL') as string,
    apiKey: configInstance.get('ollama.apiKey') as string,
    defaultModel: configInstance.get('ollama.defaultModel') as string
  }
};

// Export the config instance for direct access if needed
export const configStore = configInstance;
