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
#   SPEC_PATH    Path or URL to OpenAPI spec                     (required)
#   OUTPUT_DIR   Output directory for generated tests            (default: ./generated-tests)
#   FRAMEWORK    Test framework: vitest or jest                  (default: vitest)
#   BASE_URL     Override the server URL from the spec           (optional)
#   AUTH_HEADER  Auth header injected into every test            (optional)
#   DRY_RUN      Set to "true" for dry-run mode                 (default: false)
#   DIFF_BASE    Git ref to diff against for change detection   (default: HEAD~1)
#   SPEC_GLOB    Space-separated globs for spec file matching   (default: *.yaml *.yml *.json)

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

  log "Running: node openapi-test-gen.js ${cmd_args[*]}"
  node "$TOOL_DIR/openapi-test-gen.js" "${cmd_args[@]}"
}

main "$@"
