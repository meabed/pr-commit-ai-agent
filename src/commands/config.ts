import { logger } from '../logger';
import { blue, bold, green, red, yellow } from 'picocolors';
import { config, configInstance, initializeConfig } from '../config';

export const command = 'config';
export const describe = 'View and modify configuration settings';
export const aliases = ['conf', 'c'];

type ConfigAction = 'list' | 'set' | 'get' | 'reset' | 'exit';

export async function handler() {
  // Setup Ctrl+C handler
  process.on('SIGINT', () => {
    logger.info(yellow('\nConfiguration manager exited with Ctrl+C'));
    process.exit(0);
  });

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
  logger.info(`  ${bold('Default Model:')} ${config.model}`);

  // Provider-specific settings
  const providers = ['openai', 'anthropic', 'deepseek', 'ollama'];

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
      logger.info(`  ${bold(key)}: ${displayValue}`);
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
    logger.info('1. Set LLM provider (openai, anthropic, deepseek, ollama)');
    logger.info('2. Set default model');
    logger.info('3. Configure OpenAI settings');
    logger.info('4. Configure Anthropic settings');
    logger.info('5. Configure DeepSeek settings');
    logger.info('6. Configure Ollama settings');
    logger.info('7. Reset all settings to defaults');
    logger.info('8. Show current configuration values');
    logger.info('9. Exit configuration');

    const choice = await logger.prompt(yellow('Select an option:'), {
      type: 'select',
      options: [
        '1. Set LLM provider',
        '2. Set default model',
        '3. Configure OpenAI',
        '4. Configure Anthropic',
        '5. Configure DeepSeek',
        '6. Configure Ollama',
        '7. Reset to defaults',
        '8. Show current configuration',
        '9. Exit'
      ]
    });

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
      case '7. Reset to defaults':
        await resetConfig();
        break;
      case '8. Show current configuration':
        displayCurrentConfig();
        break;
      case '9. Exit':
        exit = true;
        break;
    }
  }

  logger.info(green('Configuration saved. Exiting configuration manager.'));
}

/**
 * Configure the LLM provider
 */
async function configureLLMProvider() {
  const provider = await logger.prompt(yellow('Select LLM provider:'), {
    type: 'select',
    options: ['openai', 'anthropic', 'deepseek', 'ollama']
  });

  await performAction('set', 'llmProvider', provider);
}

/**
 * Configure the default model
 */
async function configureDefaultModel() {
  const model = await logger.prompt(yellow('Enter default model name:'), {
    type: 'text',
    initial: config.model
  });

  await performAction('set', 'model', model);
}

/**
 * Configure a specific provider's settings
 */
async function configureProvider(provider: string) {
  const providerConfig = config[provider as keyof typeof config] as Record<string, string>;

  logger.info(bold(green(`\n=== ${provider.charAt(0).toUpperCase() + provider.slice(1)} Configuration ===`)));

  // Loop through each setting for the provider
  for (const [key, value] of Object.entries(providerConfig)) {
    const displayValue = key.toLowerCase().includes('apikey') ? (value ? '********' : '') : value;

    const newValue = await logger.prompt(yellow(`Enter ${key} (leave empty to keep current):`), {
      type: 'text',
      initial: displayValue
    });

    // Only update if user entered a new value
    if (newValue !== displayValue && newValue !== '') {
      await performAction('set', `${provider}.${key}`, newValue);
    }
  }
}

/**
 * Reset configuration to defaults
 */
async function resetConfig() {
  const confirm = await logger.prompt(red('Are you sure you want to reset all settings to defaults?'), {
    type: 'confirm'
  });

  if (confirm) {
    await performAction('reset');
    logger.info(green('All settings have been reset to defaults.'));
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
