// interactive.js — Interactive wizard for openapi-test-gen

import { select, input, confirm } from '@inquirer/prompts';
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

  // 7. Dry run
  const dryRun = await confirm({
    message: 'Dry run? (preview output without writing files)',
    default: false,
  });

  // 8. Summary + confirmation
  const summary = [
    '',
    '  Configuration Summary',
    '  ' + '─'.repeat(44),
    `  Spec:        ${spec}`,
    `  Framework:   ${framework}`,
    `  Output:      ${output}`,
    `  Base URL:    ${baseUrl || '(from spec)'}`,
    `  Auth header: ${authHeader || '(none)'}`,
    `  Dry run:     ${dryRun ? 'yes' : 'no'}`,
    '  ' + '─'.repeat(44),
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
  };
}
