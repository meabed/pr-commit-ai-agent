// Bun build configuration
await Bun.build({
  entrypoints: ['./bin/run.ts'],
  outdir: './dist',
  target: 'node',
  format: 'cjs',
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production' ? 'external' : 'none',
  external: [
    'yargs',
    'simple-git',
    'openai',
    '@anthropic-ai/sdk',
    '@ai-sdk/google',
    'ollama-ai-provider',
    'execa',
    'conf',
    'consola',
    'picocolors',
    'dotenv',
    'ai',
    'llm-cost',
    'uuid',
    'giget'
  ]
});

console.log('Build completed successfully!');
export {};
