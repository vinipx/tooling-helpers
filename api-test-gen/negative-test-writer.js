// negative-test-writer.js — Renders TestCaseDescriptors into *.negative.test.js files
// Shared by both the static rule engine and the LLM pipeline — output format is identical
// regardless of which source produced the descriptors.

// Local copy of the same helper in openapi-test-gen.js — avoids a circular import.
function sanitizeTagForFilename(tag) {
  return tag.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untagged';
}

/**
 * Generate the content of a <tag>.negative.test.js file.
 *
 * @param {string}   tag                  - OpenAPI tag name
 * @param {object[]} endpoints            - Endpoint objects, each with a .negativeCases array
 * @param {string|null} authHeader        - Global auth header string (if any)
 * @param {object}   fwConfig             - Framework config (testImportLine, etc.)
 * @returns {string}  Full file content
 */
export function generateNegativeTestFile(tag, endpoints, authHeader, fwConfig) {
  const filename = `${sanitizeTagForFilename(tag)}.negative.test.js`;

  const lines = [
    `// ${filename} — auto-generated negative/edge cases by openapi-test-gen`,
    `// DO NOT rely on these tests passing out of the box — replace PLACEHOLDER values`,
    `// with real test data before running.`,
    ``,
    fwConfig.testImportLine,
    `import { BASE_URL } from './config.js';`,
    `import { ENDPOINTS } from './endpoints.js';`,
    ``,
  ];

  // Inject AUTH_HEADERS constant if a global auth header was configured —
  // negative tests need it as the baseline to explicitly omit or override it.
  if (authHeader) {
    const colonIdx   = authHeader.indexOf(':');
    const headerName  = authHeader.slice(0, colonIdx).trim();
    const headerValue = authHeader.slice(colonIdx + 1).trim();
    lines.push(`const AUTH_HEADERS = { '${headerName}': '${headerValue}' };`);
    lines.push(`const NO_AUTH = {};  // used by auth-absence tests`);
    lines.push(``);
  }

  let totalCases = 0;

  for (const endpoint of endpoints) {
    const cases = endpoint.negativeCases || [];
    if (cases.length === 0) continue;

    const describeName = (endpoint.operationId || `${endpoint.method.toUpperCase()} ${endpoint.path}`)
      .replace(/'/g, "\\'");

    lines.push(`describe('${describeName} — negative/edge cases', () => {`);

    for (const tc of cases) {
      totalCases++;
      _renderTestCase(lines, endpoint, tc, authHeader);
    }

    lines.push(`});`);
    lines.push(``);
  }

  if (totalCases === 0) {
    lines.push(`// No negative cases could be derived for the endpoints in this tag.`);
    lines.push(``);
  }

  return lines.join('\n');
}

// ─── Internal renderer ────────────────────────────────────────────────────────

function _renderTestCase(lines, endpoint, tc, authHeader) {
  const { description, expectedStatuses, fetchOverrides, source } = tc;

  // Build the URL expression (same pattern as happy-path generator)
  const endpointRef = `ENDPOINTS.${endpoint.name}.path`;
  let pathExpr = endpointRef;

  // If this test case has a path param override, apply it to ALL path params
  if (fetchOverrides._pathParamOverride) {
    const overrideVal = fetchOverrides._pathParamOverride;
    const substitutions = endpoint.pathParams
      .map(p => `.replace('{${p}}', '${overrideVal}')`)
      .join('');
    pathExpr = `${endpointRef}${substitutions}`;
  } else {
    // Normal PLACEHOLDER substitution (same as happy path)
    const substitutions = endpoint.pathParams
      .map(p => `.replace('{${p}}', 'PLACEHOLDER_${p.toUpperCase()}')`)
      .join('');
    pathExpr = `${endpointRef}${substitutions}`;
  }

  // Build query string for invalid query param tests
  let queryString = '';
  if (fetchOverrides._invalidQueryParam) {
    const { name, value } = fetchOverrides._invalidQueryParam;
    queryString = `?${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
  }

  const urlExpression = queryString
    ? `\`\${BASE_URL}\${${pathExpr}}${queryString}\``
    : `\`\${BASE_URL}\${${pathExpr}}\``;

  // Determine which headers to use for this test
  // Auth-absence tests: use NO_AUTH (empty object) to override global auth
  // All other tests: keep auth if present, override Content-Type etc. as needed
  const isAuthTest = expectedStatuses.includes(401) || expectedStatuses.includes(403);

  // Build headers object lines
  const headerEntries = _buildHeaderEntries(fetchOverrides.headers, isAuthTest, authHeader);

  // Build fetch options
  const fetchLines = [];
  fetchLines.push(`      method: '${endpoint.method.toUpperCase()}',`);

  if (headerEntries.length > 0) {
    fetchLines.push(`      headers: {`);
    for (const entry of headerEntries) {
      fetchLines.push(`        ${entry}`);
    }
    fetchLines.push(`      },`);
  } else if (authHeader && !isAuthTest) {
    fetchLines.push(`      headers: AUTH_HEADERS,`);
  }

  if (fetchOverrides.body !== undefined && !fetchOverrides._pathParamOverride) {
    // Escape backticks and template literals in the body string
    const safeBody = fetchOverrides.body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    fetchLines.push(`      body: \`${safeBody}\`,`);
  }

  // Build status assertion
  const statusAssertion = _buildStatusAssertion(expectedStatuses);

  // Source comment
  const sourceComment = `// [source: ${source}]`;

  lines.push(`  it('${description.replace(/'/g, "\\'")}', async () => {  ${sourceComment}`);
  lines.push(`    const response = await fetch(${urlExpression}, {`);
  for (const fl of fetchLines) lines.push(`  ${fl}`);
  lines.push(`    });`);
  lines.push(statusAssertion);
  lines.push(`  });`);
  lines.push(``);
}

/**
 * Build the header entries for the fetch call.
 */
function _buildHeaderEntries(overrideHeaders, isAuthTest, globalAuthHeader) {
  const entries = [];

  if (isAuthTest) {
    // Auth-absence test: explicitly send empty headers (no auth)
    // Any Content-Type from overrides is still included
    if (overrideHeaders) {
      for (const [k, v] of Object.entries(overrideHeaders)) {
        if (k.toLowerCase() !== 'authorization') {
          entries.push(`'${k}': '${v}',`);
        }
      }
    }
    // Note: AUTH_HEADERS intentionally omitted — that IS the test
  } else if (overrideHeaders && Object.keys(overrideHeaders).length > 0) {
    // Merge global auth (if present) with test-specific headers
    if (globalAuthHeader) {
      entries.push(`...AUTH_HEADERS,`);
    }
    for (const [k, v] of Object.entries(overrideHeaders)) {
      entries.push(`'${k}': '${v}',`);
    }
  }

  return entries;
}

/**
 * Generate the Jest/Vitest assertion line for the expected statuses.
 */
function _buildStatusAssertion(expectedStatuses) {
  if (expectedStatuses.length === 0) {
    return `    expect(response.status).toBeGreaterThanOrEqual(400);`;
  }

  if (expectedStatuses.length === 1) {
    return `    expect(response.status).toBe(${expectedStatuses[0]});`;
  }

  // Check if it's a contiguous 4xx range like [400, 422]
  const all4xx = expectedStatuses.every(s => s >= 400 && s < 500);
  const all5xx = expectedStatuses.every(s => s >= 500 && s < 600);

  if (all4xx && expectedStatuses.length > 2) {
    return `    expect(response.status).toBeGreaterThanOrEqual(400);\n    expect(response.status).toBeLessThan(500);`;
  }
  if (all5xx && expectedStatuses.length > 2) {
    return `    expect(response.status).toBeGreaterThanOrEqual(500);\n    expect(response.status).toBeLessThan(600);`;
  }

  // Specific multi-value set: e.g. [400, 422] or [401, 403]
  return `    expect(${JSON.stringify(expectedStatuses)}).toContain(response.status);`;
}
