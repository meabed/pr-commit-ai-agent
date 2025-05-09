/**
 * This module implements the 'config' command, which allows users to view and modify
 * configuration settings for the GGPR tool. It supports interactive configuration
 * and direct modification of settings such as LLM provider, default model, and API keys.
 */

import { logger } from '../logger';
import { blue, bold, green, red, yellow } from 'picocolors';
import { config, configInstance, initializeConfig } from '../config';

export const command = 'config';
export const describe = 'View and modify configuration settings';
export const aliases = ['conf', 'c'];

type ConfigAction = 'list' | 'set' | 'get' | 'reset' | 'exit';

export async function handler() {
  // Interactive mode
  logger.info(bold(blue('PR-Agent Configuration Manager')));
  logger.info(yellow('Current configuration path: ') + blue(configInstance.path));
  logger.info(yellow('Press Ctrl+C at any time to exit'));

  // Display current configuration
  displayCurrentConfig();

  // Enter configuration loop
  await configurationLoop();
}

/**
 * Display all current configuration values
 */
function displayCurrentConfig() {
  logger.info(bold(green('\n=== Current Configuration ===')));

  // Global settings
  logger.info(yellow('Global Settings:'));
  logger.info(`  ${bold('LLM Provider:')} ${config.llmProvider}`);
  logger.info(`  ${bold('Default Model:')} ${config.model || '(using provider default)'}`);

  // Provider-specific settings
  const providers = ['openai', 'anthropic', 'deepseek', 'ollama', 'gemini'];

  for (const provider of providers) {
    logger.info(yellow(`\n${provider.charAt(0).toUpperCase() + provider.slice(1)} Configuration:`));

    // Display provider-specific keys
    Object.entries(config[provider as keyof typeof config] as Record<string, string>).forEach(([key, value]) => {
      // Mask API keys for security
      const displayValue = key.toLowerCase().includes('apikey')
        ? value
          ? '********'
          : '(not set)'
        : value || '(not set)';
      logger.info(`${bold(key)}: ${displayValue}`);
    });
  }
}

/**
 * Interactive configuration loop
 */
async function configurationLoop() {
  let exit = false;

  while (!exit) {
    logger.info(bold(green('\n=== Configuration Options ===')));
    logger.info('1. Set LLM provider (openai, anthropic, deepseek, ollama, gemini)');
    logger.info('2. Set default model');
    logger.info('3. Configure OpenAI settings');
    logger.info('4. Configure Anthropic settings');
    logger.info('5. Configure DeepSeek settings');
    logger.info('6. Configure Ollama settings');
    logger.info('7. Configure Gemini settings');
    logger.info('8. Reset all settings to defaults');
    logger.info('9. Show current configuration values');
    logger.info('10. Exit configuration');

    const choice = await logger.prompt(yellow('[CONFIG] Select an option:'), {
      type: 'select',
      options: [
        '1. Set LLM provider',
        '2. Set default model',
        '3. Configure OpenAI',
        '4. Configure Anthropic',
        '5. Configure DeepSeek',
        '6. Configure Ollama',
        '7. Configure Gemini',
        '8. Reset to defaults',
        '9. Show current configuration',
        '10. Exit'
      ]
    });

    if (typeof choice === 'undefined') {
      exit = true;
      return;
    }

    switch (choice) {
      case '1. Set LLM provider':
        await configureLLMProvider();
        break;
      case '2. Set default model':
        await configureDefaultModel();
        break;
      case '3. Configure OpenAI':
        await configureProvider('openai');
        break;
      case '4. Configure Anthropic':
        await configureProvider('anthropic');
        break;
      case '5. Configure DeepSeek':
        await configureProvider('deepseek');
        break;
      case '6. Configure Ollama':
        await configureProvider('ollama');
        break;
      case '7. Configure Gemini':
        await configureProvider('gemini');
        break;
      case '8. Reset to defaults':
        await resetConfig();
        break;
      case '9. Show current configuration':
        displayCurrentConfig();
        break;
      case '10. Exit':
        exit = true;
        break;
    }
  }

  logger.info(green('[CONFIG] Configuration saved. Exiting configuration manager.'));
}

/**
 * Configure the LLM provider
 */
async function configureLLMProvider() {
  const provider = await logger.prompt(yellow('[CONFIG] Select LLM provider:'), {
    type: 'select',
    options: ['openai', 'anthropic', 'deepseek', 'ollama', 'gemini']
  });

  await performAction('set', 'llmProvider', provider);

  // Suggest setting a model after changing provider
  logger.info(yellow('[CONFIG] Remember to set an appropriate model for this provider'));
  const setModel = await logger.prompt(yellow('[CONFIG] Would you like to set a default model now?'), {
    type: 'confirm'
  });

  if (setModel) {
    await configureDefaultModel(provider);
  }
}

/**
 * Configure the default model
 * @param provider - Optional provider to suggest models for
 */
async function configureDefaultModel(provider?: string) {
  const currentProvider = provider || config.llmProvider;
  let suggestedModels: string[] = [];

  // Suggest popular models based on the selected provider
  switch (currentProvider) {
    case 'openai':
      suggestedModels = ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
      break;
    case 'anthropic':
      suggestedModels = ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];
      break;
    case 'gemini':
      suggestedModels = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'];
      break;
    case 'ollama':
      suggestedModels = ['llama3', 'llama2', 'mistral', 'codellama', 'qwen2.5-coder'];
      break;
    case 'deepseek':
      suggestedModels = ['deepseek-coder', 'deepseek-chat'];
      break;
  }

  // Allow user to select from suggested models or enter their own
  let model;
  if (suggestedModels.length > 0) {
    const modelOptions = [...suggestedModels, 'Enter custom model name'];
    const selectedOption = await logger.prompt(yellow('[CONFIG] Select or enter model name:'), {
      type: 'select',
      options: modelOptions
    });

    if (selectedOption === 'Enter custom model name') {
      model = await logger.prompt(yellow('[CONFIG] Enter custom model name:'), {
        type: 'text',
        initial: config.model
      });
    } else {
      model = selectedOption;
    }
  } else {
    model = await logger.prompt(yellow('[CONFIG] Enter model name:'), {
      type: 'text',
      initial: config.model
    });
  }

  await performAction('set', 'model', model);
}

/**
 * Configure a specific provider's settings
 */
async function configureProvider(provider: string) {
  const providerConfig = config[provider as keyof typeof config] as Record<string, string>;

  logger.info(bold(green(`\n[CONFIG] === ${provider.charAt(0).toUpperCase() + provider.slice(1)} Configuration ===`)));

  // Loop through each setting for the provider
  for (const [key, value] of Object.entries(providerConfig)) {
    const displayValue = key.toLowerCase().includes('apikey') ? (value ? '********' : '') : value;

    // Special handling for base URL
    if (key === 'baseURL' && provider === 'ollama') {
      const options = ['http://localhost:11434/api/generate', 'http://localhost:11434/api/chat', 'Enter custom URL'];

      const selectedOption = await logger.prompt(yellow(`[CONFIG] Select ${key}:`), {
        type: 'select',
        options,
        initial: options.includes(value) ? value : options[0]
      });

      const newValue =
        selectedOption === 'Enter custom URL'
          ? await logger.prompt(yellow('[CONFIG] Enter custom URL:'), {
              type: 'text',
              initial: value
            })
          : selectedOption;

      if (newValue !== value && newValue !== '') {
        await performAction('set', `${provider}.${key}`, newValue);
      }
    } else {
      // Standard prompt for other settings
      const newValue = await logger.prompt(yellow(`[CONFIG] Enter ${key} (leave empty to keep current):`), {
        type: 'text',
        initial: displayValue
      });

      // Only update if user entered a new value
      if (newValue !== displayValue && newValue !== '') {
        await performAction('set', `${provider}.${key}`, newValue);
      }
    }
  }

  // After configuring a provider, offer to set it as default
  const makeDefault = await logger.prompt(yellow(`[CONFIG] Set ${provider} as your default LLM provider?`), {
    type: 'confirm'
  });

  if (makeDefault) {
    await performAction('set', 'llmProvider', provider);
    logger.info(green(`[CONFIG] ${provider.charAt(0).toUpperCase() + provider.slice(1)} set as default provider.`));
  }
}

/**
 * Reset configuration to defaults
 */
async function resetConfig() {
  const confirm = await logger.prompt(red('[CONFIG] Are you sure you want to reset all settings to defaults?'), {
    type: 'confirm'
  });

  if (confirm) {
    await performAction('reset');
    logger.info(green('[CONFIG] All settings have been reset to defaults.'));
  }
}

/**
 * Perform a configuration action
 */
async function performAction(action: ConfigAction, key?: string, value?: string) {
  switch (action) {
    case 'list':
      displayCurrentConfig();
      break;

    case 'set': {
      if (!key) {
        logger.error(red('Key must be specified for set action'));
        return;
      }

      // If value is not provided, prompt for it
      const finalValue =
        value ||
        (await logger.prompt(yellow(`Enter value for ${key}:`), {
          type: 'text'
        }));

      try {
        configInstance.set(key, finalValue);
        logger.info(green(`Updated ${key} = ${finalValue}`));
      } catch (error) {
        logger.error(red(`Failed to set ${key}: ${(error as Error).message}`));
      }
      break;
    }

    case 'get': {
      if (!key) {
        logger.error(red('Key must be specified for get action'));
        return;
      }

      const val = configInstance.get(key);
      logger.info(`${key} = ${val}`);
      break;
    }

    case 'reset': {
      configInstance.clear();
      // Re-initialize with environment variables
      initializeConfig();
      logger.info(green('Configuration reset to defaults'));
      break;
    }

    case 'exit':
      // Do nothing, just exit
      break;
  }
}
