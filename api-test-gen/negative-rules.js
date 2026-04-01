// negative-rules.js — Static rule-based negative/edge case generator
// Zero external dependencies. Derives test cases purely from the parsed OpenAPI endpoint object.

const MAX_CASES = 5;

/**
 * Build up to MAX_CASES negative/edge test case descriptors for a single endpoint.
 *
 * @param {object} endpoint  - Parsed endpoint object from openapi-test-gen
 * @param {string|null} authHeader - The auth header string if provided (e.g. "Authorization: Bearer x")
 * @returns {TestCaseDescriptor[]}
 *
 * TestCaseDescriptor shape:
 * {
 *   description:      string,
 *   expectedStatuses: number[],   // e.g. [400,422] or [401,403]
 *   fetchOverrides: {
 *     headers?: Record<string,string>,
 *     body?:    string,            // pre-serialized JSON
 *   },
 *   source: 'rules',
 * }
 */
export function buildRuleBasedCases(endpoint, authHeader) {
  const cases = [];
  const { method, path, pathParams, queryParams, bodyFields, bodySchema, responses, security } = endpoint;

  // ── Rule 1: Missing auth ─────────────────────────────────────────────────────
  // Trigger: operation declares security OR an auth header was globally provided
  if (cases.length < MAX_CASES && (security || authHeader)) {
    cases.push({
      description: 'returns 401 or 403 when auth header is absent',
      expectedStatuses: [401, 403],
      fetchOverrides: {
        headers: {}, // explicitly empty — override any default auth
      },
      source: 'rules',
    });
  }

  // ── Rule 2: Missing required body fields ─────────────────────────────────────
  // Trigger: requestBody with required fields
  const requiredFields = (bodySchema && bodySchema.required) || [];
  const bodyProperties = (bodySchema && bodySchema.properties) || {};

  for (const field of requiredFields) {
    if (cases.length >= MAX_CASES) break;
    // Build a body that has all OTHER required fields but omits this one
    const partialBody = {};
    for (const f of requiredFields) {
      if (f === field) continue;
      partialBody[f] = _placeholderValue(bodyProperties[f]);
    }
    // Also include optional-but-common fields for realism
    cases.push({
      description: `returns 4xx when required field "${field}" is omitted from request body`,
      expectedStatuses: [400, 422],
      fetchOverrides: {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partialBody),
      },
      source: 'rules',
    });
  }

  // ── Rule 3: Invalid format values ────────────────────────────────────────────
  // Trigger: a body property or query param has format: email|uuid|date|uri
  const FORMAT_INVALIDS = {
    email:    'not-an-email',
    uuid:     '00000000-XXXX-XXXX-XXXX-000000000000',
    date:     '31-13-9999',
    'date-time': '9999-99-99T99:99:99Z',
    uri:      'not a uri',
    url:      'not a url',
  };

  for (const [propName, propSchema] of Object.entries(bodyProperties)) {
    if (cases.length >= MAX_CASES) break;
    const fmt = propSchema && propSchema.format;
    if (fmt && FORMAT_INVALIDS[fmt]) {
      const invalidBody = _buildBodyWithOverride(bodyProperties, requiredFields, propName, FORMAT_INVALIDS[fmt]);
      cases.push({
        description: `returns 4xx when "${propName}" has an invalid ${fmt} format`,
        expectedStatuses: [400, 422],
        fetchOverrides: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidBody),
        },
        source: 'rules',
      });
    }
  }

  // ── Rule 4: Boundary violations ──────────────────────────────────────────────
  // Trigger: numeric minimum/maximum or string minLength/maxLength constraints
  for (const [propName, propSchema] of Object.entries(bodyProperties)) {
    if (cases.length >= MAX_CASES) break;
    if (!propSchema) continue;

    let violationValue = null;
    let constraintLabel = '';

    if (typeof propSchema.minimum === 'number') {
      violationValue = propSchema.minimum - 1;
      constraintLabel = `minimum (${propSchema.minimum})`;
    } else if (typeof propSchema.maximum === 'number') {
      violationValue = propSchema.maximum + 1;
      constraintLabel = `maximum (${propSchema.maximum})`;
    } else if (typeof propSchema.minLength === 'number') {
      violationValue = propSchema.minLength > 0 ? '' : null; // empty string violates minLength > 0
      constraintLabel = `minLength (${propSchema.minLength})`;
    } else if (typeof propSchema.maxLength === 'number') {
      violationValue = 'x'.repeat(propSchema.maxLength + 1);
      constraintLabel = `maxLength (${propSchema.maxLength})`;
    }

    if (violationValue !== null) {
      const invalidBody = _buildBodyWithOverride(bodyProperties, requiredFields, propName, violationValue);
      cases.push({
        description: `returns 4xx when "${propName}" violates ${constraintLabel}`,
        expectedStatuses: [400, 422],
        fetchOverrides: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidBody),
        },
        source: 'rules',
      });
    }
  }

  // ── Rule 5: Invalid enum value ────────────────────────────────────────────────
  // Trigger: a body property or query param has an enum constraint
  for (const [propName, propSchema] of Object.entries(bodyProperties)) {
    if (cases.length >= MAX_CASES) break;
    if (propSchema && Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
      const invalidBody = _buildBodyWithOverride(bodyProperties, requiredFields, propName, '__INVALID_ENUM_VALUE__');
      cases.push({
        description: `returns 4xx when "${propName}" is not a valid enum value`,
        expectedStatuses: [400, 422],
        fetchOverrides: {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidBody),
        },
        source: 'rules',
      });
    }
  }

  // Also check query params for enum (common in GET endpoints like findPetsByStatus)
  for (const qp of (endpoint.queryParamSchemas || [])) {
    if (cases.length >= MAX_CASES) break;
    if (qp.schema && Array.isArray(qp.schema.enum) && qp.schema.enum.length > 0) {
      cases.push({
        description: `returns 4xx when query param "${qp.name}" is not a valid enum value`,
        expectedStatuses: [400, 422],
        fetchOverrides: {
          headers: {},
          // query param injected via URL in the test — we signal it via a special key
          _invalidQueryParam: { name: qp.name, value: '__INVALID_ENUM_VALUE__' },
        },
        source: 'rules',
      });
    }
  }

  // ── Rule 6: Non-existent resource (path params) ───────────────────────────────
  // Trigger: endpoint has at least one path param
  if (cases.length < MAX_CASES && pathParams.length > 0) {
    cases.push({
      description: 'returns 404 when resource does not exist (non-existent ID)',
      expectedStatuses: [404],
      fetchOverrides: {
        _pathParamOverride: 'NONEXISTENT_99999999',
      },
      source: 'rules',
    });
  }

  // ── Rule 7: Invalid Content-Type ─────────────────────────────────────────────
  // Trigger: mutating methods (POST/PUT/PATCH) with a request body
  const mutatingMethods = ['post', 'put', 'patch'];
  if (cases.length < MAX_CASES && mutatingMethods.includes(method.toLowerCase()) && bodyFields.length > 0) {
    cases.push({
      description: 'returns 4xx when Content-Type is not application/json',
      expectedStatuses: [400, 415],
      fetchOverrides: {
        headers: { 'Content-Type': 'text/plain' },
        body: 'this is not json',
      },
      source: 'rules',
    });
  }

  return cases;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a sensible placeholder value for a given property schema.
 */
function _placeholderValue(schema) {
  if (!schema) return 'PLACEHOLDER';
  const { type, format, enum: enumVals } = schema;
  if (enumVals && enumVals.length > 0) return enumVals[0];
  if (format === 'email') return 'test@example.com';
  if (format === 'uuid') return '00000000-0000-0000-0000-000000000000';
  if (format === 'date') return '2024-01-01';
  if (format === 'date-time') return '2024-01-01T00:00:00Z';
  if (format === 'uri' || format === 'url') return 'https://example.com';
  if (type === 'integer' || type === 'number') return 1;
  if (type === 'boolean') return true;
  if (type === 'array') return [];
  if (type === 'object') return {};
  return 'PLACEHOLDER';
}

/**
 * Builds a request body object where all required fields have placeholder values,
 * but one specific field is overridden with an invalid value.
 */
function _buildBodyWithOverride(properties, requiredFields, overrideField, overrideValue) {
  const body = {};
  for (const field of requiredFields) {
    body[field] = _placeholderValue(properties[field]);
  }
  body[overrideField] = overrideValue;
  return body;
}
