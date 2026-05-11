#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate-module-docs.sh — Check native and scripted module doc structure and cross-link health.
#
# Validates both native and scripted module doc sets.
# For each set it checks:
#   1. Each module page has all required sections (frontmatter, headings).
#   2. Every module referenced in the index (index.md) resolves to an
#      existing .md file — warnings by default, errors in --strict-index mode.
#   3. Explicit module links inside module pages resolve to existing pages.
#
# Usage:
#   ./scripts/validate-module-docs.sh [--strict-index]
#   npm run validate:modules
#
# Exit code: 0 if all good, 1 if any errors found.
# ---------------------------------------------------------------------------
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

ERRORS=0
WARNINGS=0
STRICT_INDEX=0

if [[ "${1:-}" == "--strict-index" ]]; then
  STRICT_INDEX=1
fi

pass() { echo "  ✓ $*"; }
warn() { echo "  ⚠ $*"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "  ✖ $*"; ERRORS=$((ERRORS + 1)); }
maybe_fail_index() {
  if [[ "$STRICT_INDEX" -eq 1 ]]; then
    fail "$*"
  else
    warn "$*"
  fi
}

extract_frontmatter_field() {
  local file="$1"
  local field="$2"

  awk -v key="$field" '
    NR == 1 {
      if ($0 != "---") exit
      in_frontmatter = 1
      next
    }
    in_frontmatter && $0 == "---" { exit }
    in_frontmatter && $0 ~ ("^" key ":[[:space:]]*") {
      sub("^" key ":[[:space:]]*", "", $0)
      print $0
      exit
    }
  ' "$file"
}

validate_doc_set() {
  local set_name="$1"
  local docs_dir="$2"
  local index_path="$3"
  shift 3
  local required_headings=("$@")

  ERRORS=0
  WARNINGS=0

  echo "=== ${set_name} page structure check ==="
  echo ""

  while IFS= read -r -d '' file; do
    slug="$(basename "$file" .md)"
    [[ "$slug" == "index" ]] && continue

    issues=0

    title_value="$(extract_frontmatter_field "$file" "title")"
    description_value="$(extract_frontmatter_field "$file" "description")"

    if [[ -z "$title_value" ]]; then
      fail "$file: missing frontmatter 'title'"
      issues=1
    fi

    if [[ -z "$description_value" ]]; then
      fail "$file: missing frontmatter 'description'"
      issues=1
    fi

    if ! grep -q '^# ' "$file"; then
      fail "$file: missing H1 (# Title)"
      issues=1
    fi

    for heading in "${required_headings[@]}"; do
      if ! grep -Fxq "$heading" "$file"; then
        fail "$file: missing section \"$heading\""
        issues=1
      fi
    done

    if grep -q '\$[A-Z][A-Z0-9_]*' "$file"; then
      warn "$file: contains unreplaced template placeholders"
    fi

    if [[ "$issues" -eq 0 ]]; then
      pass "$set_name → $slug"
    fi
  done < <(find "$docs_dir" -maxdepth 1 -name '*.md' -print0)

  echo ""
  echo "--- ${set_name} page structure: ${ERRORS} error(s), ${WARNINGS} warning(s) ---"
  echo ""

  CUMULATIVE_ERRORS=$((CUMULATIVE_ERRORS + ERRORS))
  CUMULATIVE_WARNINGS=$((CUMULATIVE_WARNINGS + WARNINGS))

  echo "=== ${set_name} index cross-link resolution ==="
  echo ""

  ERRORS=0
  WARNINGS=0

  local link_pattern=""
  case "$set_name" in
    "Native modules")
      link_pattern='/docs/reference/modules/\K[a-z0-9-]+(?=\))'
      ;;
    "Scripted modules")
      link_pattern='/docs/reference/scripted-modules/\K[a-z0-9-]+(?=\))'
      ;;
  esac

  LINK_SLUGS=$(grep -oP "$link_pattern" "$index_path" 2>/dev/null || true)

  if [[ -z "$LINK_SLUGS" ]]; then
    warn "No module links found in $index_path (may need updating)"
  fi

  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    target="$docs_dir/$slug.md"
    if [[ ! -f "$target" ]]; then
      maybe_fail_index "$index_path references '$slug' but $slug.md does not exist"
    else
      pass "$set_name index → $slug.md ✓"
    fi
  done <<< "$LINK_SLUGS"

  EXISTING_SLUGS=()
  while IFS= read -r -d '' file; do
    slug="$(basename "$file" .md)"
    [[ "$slug" == "index" ]] && continue
    EXISTING_SLUGS+=("$slug")
  done < <(find "$docs_dir" -maxdepth 1 -name '*.md' -print0)

  local index_prefix=""
  case "$set_name" in
    "Native modules")
      index_prefix="/docs/reference/modules"
      ;;
    "Scripted modules")
      index_prefix="/docs/reference/scripted-modules"
      ;;
  esac

  for slug in "${EXISTING_SLUGS[@]}"; do
    if ! grep -q "$index_prefix/$slug)" "$index_path"; then
      warn "$docs_dir/$slug.md exists but is not listed in $index_path"
    fi
  done

  echo ""
  echo "--- ${set_name} index links: ${ERRORS} error(s), ${WARNINGS} warning(s) ---"
  echo ""

  CUMULATIVE_ERRORS=$((CUMULATIVE_ERRORS + ERRORS))
  CUMULATIVE_WARNINGS=$((CUMULATIVE_WARNINGS + WARNINGS))

  echo "=== ${set_name} module cross-link resolution ==="
  echo ""

  ERRORS=0
  WARNINGS=0

  while IFS= read -r -d '' file; do
    slug="$(basename "$file" .md)"
    [[ "$slug" == "index" ]] && continue

    page_links=$(grep -oP "$link_pattern" "$file" 2>/dev/null || true)

    if [[ -z "$page_links" ]]; then
      continue
    fi

    while IFS= read -r linked_slug; do
      [[ -z "$linked_slug" ]] && continue
      target="$docs_dir/$linked_slug.md"
      if [[ ! -f "$target" ]]; then
        fail "$slug.md links to missing $set_name module '$linked_slug'"
      else
        pass "$slug.md → $linked_slug.md ✓"
      fi
    done <<< "$page_links"
  done < <(find "$docs_dir" -maxdepth 1 -name '*.md' -print0)

  echo ""
  echo "--- ${set_name} module links: ${ERRORS} error(s), ${WARNINGS} warning(s) ---"
  echo ""

  CUMULATIVE_ERRORS=$((CUMULATIVE_ERRORS + ERRORS))
  CUMULATIVE_WARNINGS=$((CUMULATIVE_WARNINGS + WARNINGS))
}

CUMULATIVE_ERRORS=0
CUMULATIVE_WARNINGS=0

validate_doc_set \
  "Native modules" \
  "$BASE_DIR/src/content/docs/reference/modules" \
  "$BASE_DIR/src/content/docs/reference/modules/index.md" \
  "## When to use this module" \
  "## nginx.conf synthesis" \
  "## Directive reference" \
  "## Works well with"

validate_doc_set \
  "Scripted modules" \
  "$BASE_DIR/src/content/docs/reference/scripted-modules" \
  "$BASE_DIR/src/content/docs/reference/scripted-modules/index.md" \
  "## When to use this module" \
  "## nginx.conf synthesis" \
  "## Public Gleam API" \
  "## Works well with"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "=== Summary ==="
echo "  Errors:   $CUMULATIVE_ERRORS"
echo "  Warnings: $CUMULATIVE_WARNINGS"
echo ""

if [[ "$CUMULATIVE_ERRORS" -gt 0 ]]; then
  echo "❌ Some module docs need attention (see above)."
else
  echo "✅ All module docs look good."
fi

exit $(( CUMULATIVE_ERRORS > 0 ? 1 : 0 ))
