#!/usr/bin/env bash
# generate-tests.sh — CI/CD wrapper for openapi-test-gen
#
# Generates API test scaffolds from OpenAPI specs, with optional
# git-based change detection to skip generation when specs haven't changed.
#
# Usage:
#   bash ci/generate-tests.sh [--check-diff]
#
# Environment variables:
#   SPEC_PATH      Path or URL to OpenAPI spec                       (required)
#   OUTPUT_DIR     Output directory for generated tests              (default: ./generated-tests)
#   FRAMEWORK      Test framework: vitest or jest                    (default: vitest)
#   BASE_URL       Override the server URL from the spec             (optional)
#   AUTH_HEADER    Auth header injected into every test              (optional)
#   DRY_RUN        Set to "true" for dry-run mode                   (default: false)
#   DIFF_BASE      Git ref to diff against for change detection      (default: HEAD~1)
#   SPEC_GLOB      Space-separated globs for spec file matching      (default: *.yaml *.yml *.json)
#
#   TEST_MODE      happy-only | negative-only | all                  (default: happy-only)
#                  Controls which test files are generated.
#                  Set to "all" to generate both happy-path and negative/edge case tests.
#
#   LLM_PROVIDER   rules | ollama | openai | anthropic               (default: rules)
#                  "rules"     — static rule engine, no dependencies needed
#                  "ollama"    — local Ollama instance (see LLM_URL, LLM_MODEL)
#                  "openai"    — requires OPENAI_API_KEY env var
#                  "anthropic" — requires ANTHROPIC_API_KEY env var
#
#   LLM_MODEL      Model name override                               (provider-specific default if unset)
#   LLM_URL        Ollama base URL                                   (default: http://localhost:11434)
#
#   OPENAI_API_KEY     API key for OpenAI   (sourced from CI secrets — never pass as CLI arg)
#   ANTHROPIC_API_KEY  API key for Anthropic (sourced from CI secrets — never pass as CLI arg)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Helpers ───────────────────────────────────────────────────────────────────

log()   { echo "[generate-tests] $*"; }
error() { echo "[generate-tests] ERROR: $*" >&2; }

# ─── Change Detection ─────────────────────────────────────────────────────────

check_diff() {
  local diff_base="${DIFF_BASE:-HEAD~1}"
  local spec_glob="${SPEC_GLOB:-*.yaml *.yml *.json}"

  local changed
  # Build git diff arguments from glob patterns
  local diff_args=()
  for pattern in $spec_glob; do
    diff_args+=("$pattern")
  done

  changed=$(git diff --name-only "$diff_base" -- "${diff_args[@]}" 2>/dev/null || true)

  if [ -z "$changed" ]; then
    log "No spec files changed since $diff_base. Skipping test generation."
    exit 0
  fi

  log "Spec changes detected:"
  echo "$changed" | while IFS= read -r file; do
    echo "  - $file"
  done
}

# ─── Main ──────────────────────────────────────────────────────────────────────

main() {
  local do_check_diff=false

  # Parse flags
  for arg in "$@"; do
    case "$arg" in
      --check-diff) do_check_diff=true ;;
      --help|-h)
        echo "Usage: bash ci/generate-tests.sh [--check-diff]"
        echo ""
        echo "Set SPEC_PATH and other env vars to configure. See script header for details."
        exit 0
        ;;
      *)
        error "Unknown flag: $arg"
        exit 1
        ;;
    esac
  done

  # Validate required env vars
  if [ -z "${SPEC_PATH:-}" ]; then
    error "SPEC_PATH environment variable is required."
    echo ""
    echo "Example:"
    echo "  SPEC_PATH=./api.yaml bash ci/generate-tests.sh"
    exit 1
  fi

  # Run change detection if requested
  if [ "$do_check_diff" = true ]; then
    check_diff
  fi

  # Build command arguments
  local cmd_args=("--spec" "$SPEC_PATH")

  if [ -n "${OUTPUT_DIR:-}" ]; then
    cmd_args+=("--output" "$OUTPUT_DIR")
  fi

  if [ -n "${FRAMEWORK:-}" ]; then
    cmd_args+=("--framework" "$FRAMEWORK")
  fi

  if [ -n "${BASE_URL:-}" ]; then
    cmd_args+=("--base-url" "$BASE_URL")
  fi

  if [ -n "${AUTH_HEADER:-}" ]; then
    cmd_args+=("--auth-header" "$AUTH_HEADER")
  fi

  if [ "${DRY_RUN:-false}" = "true" ]; then
    cmd_args+=("--dry-run")
  fi

  # ── Test mode and LLM options (new) ──────────────────────────────────────────
  # TEST_MODE defaults to "happy-only" so existing pipelines are unaffected.
  local test_mode="${TEST_MODE:-happy-only}"
  cmd_args+=("--test-mode" "$test_mode")

  local llm_provider="${LLM_PROVIDER:-rules}"
  cmd_args+=("--llm-provider" "$llm_provider")

  if [ -n "${LLM_MODEL:-}" ]; then
    cmd_args+=("--llm-model" "$LLM_MODEL")
  fi

  if [ -n "${LLM_URL:-}" ]; then
    cmd_args+=("--llm-url" "$LLM_URL")
  fi

  # API keys are consumed directly from environment variables inside the tool.
  # They are intentionally NOT forwarded as --llm-api-key CLI args to avoid
  # them appearing in shell history or process listings.
  # Make sure OPENAI_API_KEY / ANTHROPIC_API_KEY are set in your CI secrets vault.

  log "Running: node openapi-test-gen.js ${cmd_args[*]}"
  node "$TOOL_DIR/openapi-test-gen.js" "${cmd_args[@]}"
}

main "$@"
