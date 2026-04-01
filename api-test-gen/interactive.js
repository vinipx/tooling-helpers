// interactive.js — Interactive wizard for openapi-test-gen

import { select, input, confirm, password } from '@inquirer/prompts';
import { existsSync } from 'fs';

export async function runWizard() {
  console.log('\n  openapi-test-gen — Interactive Setup\n');

  // 1. Spec source type
  const sourceType = await select({
    message: 'How would you like to provide the OpenAPI spec?',
    choices: [
      { name: 'Local file (.json / .yaml / .yml)', value: 'file' },
      { name: 'URL (SwaggerHub, remote server, etc.)', value: 'url' },
    ],
  });

  // 2. Spec path or URL
  let spec;
  if (sourceType === 'file') {
    spec = await input({
      message: 'Path to spec file:',
      default: './openapi.yaml',
      validate(value) {
        if (!value.trim()) return 'Path cannot be empty.';
        if (!/\.(json|ya?ml)$/i.test(value)) return 'File must end in .json, .yaml, or .yml';
        if (!existsSync(value)) return `File not found: ${value}`;
        return true;
      },
    });
  } else {
    spec = await input({
      message: 'Spec URL:',
      validate(value) {
        if (!value.trim()) return 'URL cannot be empty.';
        if (!/^https?:\/\/.+/.test(value)) return 'Must be a valid http:// or https:// URL';
        return true;
      },
    });
  }

  // 3. Framework
  const framework = await select({
    message: 'Test framework:',
    choices: [
      { name: 'Vitest', value: 'vitest' },
      { name: 'Jest', value: 'jest' },
    ],
  });

  // 4. Output directory
  const output = await input({
    message: 'Output directory:',
    default: './generated-tests',
    validate(value) {
      if (!value.trim()) return 'Output directory cannot be empty.';
      return true;
    },
  });

  // 5. Base URL override (optional)
  const baseUrl = await input({
    message: 'Base URL override (leave empty to use spec\'s server URL):',
    default: '',
    validate(value) {
      if (value && !/^https?:\/\/.+/.test(value)) return 'Must be a valid http:// or https:// URL';
      return true;
    },
  });

  // 6. Auth header (optional)
  const authHeader = await input({
    message: 'Auth header (e.g. "Authorization: Bearer TOKEN", leave empty for none):',
    default: '',
    validate(value) {
      if (value && !value.includes(':')) return 'Auth header must be in "Name: Value" format (must contain ":")';
      return true;
    },
  });

  // 7. Test generation mode
  const testMode = await select({
    message: 'Test generation mode:',
    choices: [
      { name: 'Happy path only  (default — current behaviour)',        value: 'happy-only' },
      { name: 'Happy path + negative/edge cases  (recommended)',       value: 'all' },
      { name: 'Negative/edge cases only',                              value: 'negative-only' },
    ],
  });

  // 8. Negative case source (only when negative tests are requested)
  let llmOptions = { provider: 'rules', model: null, url: null, apiKey: null };

  if (testMode !== 'happy-only') {
    const negSource = await select({
      message: 'How should negative cases be generated?',
      choices: [
        { name: 'Static rules  — deterministic, zero dependencies, works offline  (recommended)', value: 'rules' },
        { name: 'LLM-powered   — smarter cases, requires provider setup',                         value: 'llm' },
      ],
    });

    if (negSource === 'llm') {
      // 9. LLM provider
      const llmProvider = await select({
        message: 'LLM provider:',
        choices: [
          { name: 'Ollama   (local — no API key required, recommended)', value: 'ollama' },
          { name: 'OpenAI   (requires OPENAI_API_KEY)',                   value: 'openai' },
          { name: 'Anthropic (requires ANTHROPIC_API_KEY)',               value: 'anthropic' },
        ],
      });

      // 10. Model name (provider-specific defaults)
      const modelDefaults = { ollama: 'llama3.2', openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5' };
      const llmModel = await input({
        message: `Model name:`,
        default: modelDefaults[llmProvider],
        validate(value) {
          if (!value.trim()) return 'Model name cannot be empty.';
          return true;
        },
      });

      // 11. Ollama base URL (only for Ollama)
      let llmUrl = null;
      if (llmProvider === 'ollama') {
        llmUrl = await input({
          message: 'Ollama base URL:',
          default: 'http://localhost:11434',
          validate(value) {
            if (!value.trim()) return 'URL cannot be empty.';
            if (!/^https?:\/\/.+/.test(value)) return 'Must be a valid http:// or https:// URL';
            return true;
          },
        });
      }

      // 12. API key (only for remote providers)
      let llmApiKey = null;
      if (llmProvider === 'openai' || llmProvider === 'anthropic') {
        const envVarName = llmProvider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
        const envAlreadySet = !!process.env[envVarName];

        console.log(`\n  Note: The key will be written to <output>/.env and excluded from git via .gitignore.`);
        if (envAlreadySet) {
          console.log(`  ${envVarName} is already set in your environment — leave blank to reuse it.\n`);
        } else {
          console.log(`  ${envVarName} is not set in your environment.\n`);
        }

        const rawKey = await password({
          message: `${envVarName} (leave blank to use shell env var):`,
          mask: '*',
        });
        llmApiKey = rawKey && rawKey.trim() ? rawKey.trim() : null;

        if (!llmApiKey && !envAlreadySet) {
          console.log(`\n  Warning: ${envVarName} is not set. LLM calls will fail unless you set it before running.\n`);
        }
      }

      llmOptions = { provider: llmProvider, model: llmModel, url: llmUrl, apiKey: llmApiKey };
    }
    // negSource === 'rules': llmOptions stays at default { provider: 'rules', ... }
  }

  // 13. Dry run
  const dryRun = await confirm({
    message: 'Dry run? (preview output without writing files)',
    default: false,
  });

  // 14. Summary + confirmation
  const negSourceLabel = testMode === 'happy-only'
    ? '(n/a)'
    : llmOptions.provider === 'rules'
      ? 'static rules'
      : `llm  (${llmOptions.provider} / ${llmOptions.model}${llmOptions.url ? ' @ ' + llmOptions.url : ''})`;

  const apiKeyLabel = llmOptions.apiKey
    ? '(provided — will be saved to .env)'
    : (llmOptions.provider !== 'rules' && llmOptions.provider !== 'ollama')
      ? '(from environment)'
      : '(not required)';

  const summary = [
    '',
    '  Configuration Summary',
    '  ' + '─'.repeat(52),
    `  Spec:        ${spec}`,
    `  Framework:   ${framework}`,
    `  Output:      ${output}`,
    `  Base URL:    ${baseUrl || '(from spec)'}`,
    `  Auth header: ${authHeader || '(none)'}`,
    `  Test mode:   ${testMode}`,
    `  Neg. source: ${negSourceLabel}`,
    `  API key:     ${apiKeyLabel}`,
    `  Dry run:     ${dryRun ? 'yes' : 'no'}`,
    '  ' + '─'.repeat(52),
    '',
  ].join('\n');
  console.log(summary);

  const proceed = await confirm({
    message: 'Proceed with generation?',
    default: true,
  });

  if (!proceed) {
    console.log('\n  Cancelled.\n');
    return null;
  }

  return {
    spec,
    output,
    baseUrl: baseUrl || undefined,
    authHeader: authHeader || undefined,
    framework,
    dryRun,
    testMode,
    llmOptions,
  };
}
