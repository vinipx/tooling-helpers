# tooling-helpers

A collection of developer productivity utilities.

---

## openapi-test-gen

CLI utility that reads an OpenAPI 3.x specification and auto-generates a JavaScript test scaffold (Vitest).

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
| `--dry-run` | Print generated file contents to stdout without writing to disk | `false` |

### Examples

```bash
# Local YAML file
node openapi-test-gen.js --spec ./petstore.yaml --output ./tests

# SwaggerHub URL
node openapi-test-gen.js \
  --spec https://api.swaggerhub.com/apis/myorg/myapi/1.0.0 \
  --base-url https://staging.myapi.com \
  --auth-header "Authorization: Bearer __TOKEN__"

# Preview output without writing
node openapi-test-gen.js --spec ./petstore.yaml --dry-run
```

### What gets generated

```
generated-tests/
  endpoints.js        # Frozen ENDPOINTS map: { method, path } per operation
  validators.js       # Ajv-compiled validators for every 2xx response schema
  package.json        # type:module + vitest/ajv dev deps + "test" script
  README.md           # Setup & run instructions
  users.test.js       # One Vitest test file per API tag
  orders.test.js
  ...
```

### Running generated tests

```bash
cd generated-tests
npm install
npm test
```

### Requirements

- Node.js >= 18 (uses native `fetch`)
