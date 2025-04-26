import 'dotenv/config';

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '', // OpenAI API key
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    defaultModel: 'gpt-3.5-turbo' // Default OpenAI model
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '', // Anthropic API key
    defaultModel: 'claude-3' // Default Anthropic model
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '', // DeepSeek API key
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat' // Default DeepSeek model
  },
  ollama: {
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api/chat', // Ollama API base URL
    apiKey: process.env.OLLAMA_API_KEY || '', // Ollama API key
    defaultModel: process.env.OLLAMA_DEFAULT_MODEL || 'llama2' // Default Ollama model
  }
};
