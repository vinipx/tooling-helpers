// llm-test-gen.js — LangChain-powered negative/edge case generator
// Dynamically imported — only loaded when --llm-provider is not 'rules'.
// All LangChain packages are optionalDependencies; missing packages produce
// a clear error message guiding the user to install them.

import { buildRuleBasedCases } from './negative-rules.js';

const MAX_CASES = 5;

// ─── Provider defaults ────────────────────────────────────────────────────────

export const LLM_DEFAULTS = {
  ollama:    { model: 'llama3.2',        url: 'http://localhost:11434' },
  openai:    { model: 'gpt-4o-mini',     url: null },
  anthropic: { model: 'claude-haiku-4-5', url: null },
};

// ─── Zod schema for output validation ────────────────────────────────────────
// Validated lazily so the import only fails if zod is truly missing AND LLM is used.

function buildZodSchema(z) {
  return z.array(
    z.object({
      description:      z.string(),
      expectedStatuses: z.array(z.number().int().min(100).max(599)),
      fetchOverrides: z.object({
        headers: z.record(z.string()).optional(),
        body:    z.string().optional(),
      }),
    })
  ).max(MAX_CASES);
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert API test engineer specializing in negative and edge case testing.
Given an API endpoint definition, generate up to ${MAX_CASES} negative or edge case test scenarios.

Rules:
- Focus on cases that are likely to expose real bugs: missing required fields, invalid formats,
  boundary violations, bad enum values, missing auth, wrong Content-Type, non-existent resources.
- Each test case must be actionable: include the exact HTTP headers and request body (as a JSON string) needed.
- expectedStatuses must be an array of plausible HTTP error status codes (4xx or 5xx).
- Return ONLY a valid JSON array. No markdown, no explanation, no code fences.

JSON schema for each element:
{
  "description":      "<short test description, starts with 'returns Nxx when ...' >",
  "expectedStatuses": [<integer status codes>],
  "fetchOverrides": {
    "headers": { "<header-name>": "<header-value>" },   // optional
    "body":    "<JSON-encoded string of request body>"  // optional
  }
}`;

// ─── Build LLM test cases ─────────────────────────────────────────────────────

/**
 * Generate up to MAX_CASES negative test descriptors using an LLM.
 * On any failure, warns and falls back to the static rule engine.
 *
 * @param {object} endpoint    - Parsed endpoint (same shape as used in openapi-test-gen)
 * @param {object} llmOptions  - { provider, model, url, apiKey }
 * @returns {Promise<TestCaseDescriptor[]>}
 */
export async function buildLLMCases(endpoint, llmOptions) {
  const { provider, model, url, apiKey } = llmOptions;
  const { method, path } = endpoint;

  try {
    // ── 1. Dynamically import LangChain packages ──────────────────────────────
    let chatModel;

    if (provider === 'ollama') {
      const { ChatOllama } = await _requireOptional('@langchain/ollama',
        'npm install @langchain/ollama');
      chatModel = new ChatOllama({
        baseUrl: url || LLM_DEFAULTS.ollama.url,
        model:   model || LLM_DEFAULTS.ollama.model,
        format:  'json',
      });

    } else if (provider === 'openai') {
      const { ChatOpenAI } = await _requireOptional('@langchain/openai',
        'npm install @langchain/openai');
      const resolvedKey = apiKey || process.env.OPENAI_API_KEY;
      if (!resolvedKey) throw new Error('OPENAI_API_KEY is not set. Provide it via --llm-api-key, the interactive wizard, or the OPENAI_API_KEY environment variable.');
      chatModel = new ChatOpenAI({
        model:   model || LLM_DEFAULTS.openai.model,
        apiKey:  resolvedKey,
        temperature: 0,
      });

    } else if (provider === 'anthropic') {
      const { ChatAnthropic } = await _requireOptional('@langchain/anthropic',
        'npm install @langchain/anthropic');
      const resolvedKey = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!resolvedKey) throw new Error('ANTHROPIC_API_KEY is not set. Provide it via --llm-api-key, the interactive wizard, or the ANTHROPIC_API_KEY environment variable.');
      chatModel = new ChatAnthropic({
        model:   model || LLM_DEFAULTS.anthropic.model,
        apiKey:  resolvedKey,
        temperature: 0,
      });

    } else {
      throw new Error(`Unknown LLM provider: "${provider}". Valid options: ollama, openai, anthropic`);
    }

    // ── 2. Import LangChain core ──────────────────────────────────────────────
    const { ChatPromptTemplate }  = await _requireOptional('@langchain/core/prompts',
      'npm install @langchain/core');
    const { JsonOutputParser }    = await _requireOptional('@langchain/core/output_parsers',
      'npm install @langchain/core');
    const { z }                   = await _requireOptional('zod', 'npm install zod');

    // ── 3. Build the user prompt with endpoint context ────────────────────────
    const endpointContext = JSON.stringify({
      method:            endpoint.method.toUpperCase(),
      path:              endpoint.path,
      operationId:       endpoint.operationId || null,
      summary:           endpoint.summary || null,
      description:       endpoint.opDescription || null,
      pathParams:        endpoint.pathParams,
      queryParams:       endpoint.queryParams,
      requestBodySchema: endpoint.bodySchema || null,
      responseCodes:     Object.keys(endpoint.responses || {}),
      hasSecurity:       !!endpoint.security,
    }, null, 2);

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', SYSTEM_PROMPT],
      ['human',  'Endpoint definition:\n{endpointContext}\n\nGenerate up to {maxCases} negative test cases as a JSON array.'],
    ]);

    // ── 4. Build and invoke the chain ─────────────────────────────────────────
    const parser = new JsonOutputParser();
    const chain  = prompt.pipe(chatModel).pipe(parser);

    const rawResult = await chain.invoke({
      endpointContext,
      maxCases: String(MAX_CASES),
    });

    // ── 5. Validate output shape with Zod ─────────────────────────────────────
    const schema      = buildZodSchema(z);
    const parseResult = schema.safeParse(rawResult);

    if (!parseResult.success) {
      throw new Error(`LLM returned invalid structure: ${parseResult.error.message}`);
    }

    // ── 6. Tag results and return ─────────────────────────────────────────────
    return parseResult.data.map(tc => ({ ...tc, source: 'llm' }));

  } catch (err) {
    // ── Warn and fall back to static rules ────────────────────────────────────
    console.warn(
      `\n  [warn] LLM case generation failed for ${method.toUpperCase()} ${path}` +
      `\n         Reason: ${err.message}` +
      `\n         Falling back to static rule engine for this endpoint.\n`
    );
    return buildRuleBasedCases(endpoint, null).map(tc => ({ ...tc, source: 'rules' }));
  }
}

// ─── Helper: dynamic import with friendly error ───────────────────────────────

async function _requireOptional(packageName, installHint) {
  try {
    return await import(packageName);
  } catch {
    throw new Error(
      `Optional package "${packageName}" is not installed.\n` +
      `  To use LLM-powered test generation, run:\n` +
      `    ${installHint}\n` +
      `  Or install all LLM dependencies at once:\n` +
      `    npm install --include=optional`
    );
  }
}
