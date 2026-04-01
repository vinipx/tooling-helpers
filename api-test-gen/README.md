# tooling-helpers

A collection of developer productivity utilities.

---

## openapi-test-gen

CLI utility that reads an OpenAPI 3.x specification and auto-generates a JavaScript test scaffold (Vitest or Jest).

### Install

```bash
npm install
```

### Usage

```bash
node openapi-test-gen.js --spec <path|url> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--spec` | Local `.json`/`.yaml` file path **or** SwaggerHub URL | *(required)* |
| `--output` | Destination directory for generated files | `./generated-tests` |
| `--base-url` | Override the server URL found in the spec | *(from spec)* |
| `--auth-header` | Auth header injected into every test (e.g. `"Authorization: Bearer __TOKEN__"`) | *(none)* |
| `--framework` | Test framework to generate for: `vitest` or `jest` | `vitest` |
| `--dry-run` | Print generated file contents to stdout without writing to disk | `false` |

### Interactive Mode

Run with no arguments to launch the interactive wizard:

```bash
node openapi-test-gen.js
```

The wizard prompts you step-by-step for:
- Spec source (local file or URL)
- Test framework (Vitest or Jest)
- Output directory
- Base URL override (optional)
- Auth header (optional)
- Dry run toggle

You can also explicitly invoke it with:

```bash
node openapi-test-gen.js --interactive
```

### Examples (non-interactive)

```bash
# Local YAML file
node openapi-test-gen.js --spec ./petstore.yaml --output ./tests

# SwaggerHub URL
node openapi-test-gen.js \
  --spec https://api.swaggerhub.com/apis/myorg/myapi/1.0.0 \
  --base-url https://staging.myapi.com \
  --auth-header "Authorization: Bearer __TOKEN__"

# Generate Jest tests instead of Vitest
node openapi-test-gen.js --spec ./petstore.yaml --framework jest --output ./tests

# Preview output without writing
node openapi-test-gen.js --spec ./petstore.yaml --dry-run
```

### What gets generated

```
generated-tests/
  endpoints.js        # Frozen ENDPOINTS map: { method, path } per operation
  validators.js       # Ajv-compiled validators for every 2xx response schema
  package.json        # type:module + framework/ajv dev deps + "test" script
  README.md           # Setup & run instructions
  jest.config.js      # Only when --framework jest
  users.test.js       # One test file per API tag (Vitest or Jest)
  orders.test.js
  ...
```

### Running generated tests

```bash
cd generated-tests
npm install
npm test
```

### CI/CD Integration

A shell script is provided at `ci/generate-tests.sh` for pipeline use. It reads configuration from environment variables and optionally skips generation if no spec files changed.

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SPEC_PATH` | Path or URL to OpenAPI spec | *(required)* |
| `OUTPUT_DIR` | Output directory for generated tests | `./generated-tests` |
| `FRAMEWORK` | `vitest` or `jest` | `vitest` |
| `BASE_URL` | Override server URL from spec | *(from spec)* |
| `AUTH_HEADER` | Auth header for all tests | *(none)* |
| `DRY_RUN` | Set to `"true"` for dry run | `false` |
| `DIFF_BASE` | Git ref for change detection | `HEAD~1` |
| `SPEC_GLOB` | Globs for spec file matching | `*.yaml *.yml *.json` |

#### Basic Usage

```bash
SPEC_PATH=./api.yaml bash ci/generate-tests.sh
```

#### With Change Detection

```bash
SPEC_PATH=./api.yaml bash ci/generate-tests.sh --check-diff
```

When `--check-diff` is passed, the script runs `git diff` against `DIFF_BASE` and exits early (code 0) if no spec files changed — keeping your pipeline fast.

#### GitHub Actions Example

```yaml
name: Generate API Tests
on:
  push:
    paths: ['**/*.yaml', '**/*.yml', '**/*.json']

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
        working-directory: api-test-gen
      - name: Generate tests if spec changed
        working-directory: api-test-gen
        env:
          SPEC_PATH: ../specs/api.yaml
          FRAMEWORK: vitest
        run: bash ci/generate-tests.sh --check-diff
      - uses: actions/upload-artifact@v4
        with:
          name: generated-tests
          path: generated-tests/
```

### Requirements

- Node.js >= 18 (uses native `fetch`)
