#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate-module-docs.sh — Check module doc structure and cross-link health.
#
# Validates three things:
#   1. Each module page in src/content/docs/reference/modules/ has all
#      required sections (frontmatter, headings).
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
MODULES_DIR="$BASE_DIR/src/content/docs/reference/modules"
INDEX="$MODULES_DIR/index.md"

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

# ---------------------------------------------------------------------------
# Section 1: Check required headings and frontmatter on every module page
# ---------------------------------------------------------------------------
echo "=== Module page structure check ==="
echo ""

REQUIRED_HEADINGS=(
  "## When to use this module"
  "## nginx.conf synthesis"
  "## Directive reference"
  "## Works well with"
)

while IFS= read -r -d '' file; do
  slug="$(basename "$file" .md)"
  [[ "$slug" == "index" ]] && continue  # skip index

  basename "$file"
  issues=0

  title_value="$(extract_frontmatter_field "$file" "title")"
  description_value="$(extract_frontmatter_field "$file" "description")"

  # --- Frontmatter: title ---
  if [[ -z "$title_value" ]]; then
    fail "$file: missing frontmatter 'title'"
    issues=1
  fi

  # --- Frontmatter: description ---
  if [[ -z "$description_value" ]]; then
    fail "$file: missing frontmatter 'description'"
    issues=1
  fi

  # --- H1 ---
  if ! grep -q '^# ' "$file"; then
    fail "$file: missing H1 (# Title)"
    issues=1
  fi

  # --- Required H2 sections ---
  for heading in "${REQUIRED_HEADINGS[@]}"; do
    if ! grep -Fxq "$heading" "$file"; then
      fail "$file: missing section \"$heading\""
      issues=1
    fi
  done

  if grep -q '\$[A-Z][A-Z0-9_]*' "$file"; then
    warn "$file: contains unreplaced template placeholders"
  fi

  if [[ "$issues" -eq 0 ]]; then
    pass "$slug"
  fi
done < <(find "$MODULES_DIR" -maxdepth 1 -name '*.md' -print0)

echo ""
echo "--- Page structure: ${ERRORS} error(s), ${WARNINGS} warning(s) ---"
echo ""

CUMULATIVE_ERRORS=$ERRORS
CUMULATIVE_WARNINGS=$WARNINGS

# ---------------------------------------------------------------------------
# Section 2: Verify index.md links resolve to real files
# ---------------------------------------------------------------------------
echo "=== Index cross-link resolution ==="
echo ""

ERRORS=0
WARNINGS=0

# Extract all /docs/reference/modules/<slug> paths from index.md links
# Matches lines like: - [Any Text](/docs/reference/modules/some-slug)
LINK_SLUGS=$(grep -oP '/docs/reference/modules/\K[a-z0-9-]+(?=\))' "$INDEX" 2>/dev/null || true)

if [[ -z "$LINK_SLUGS" ]]; then
  warn "No module links found in index.md (may need updating)"
fi

while IFS= read -r slug; do
  [[ -z "$slug" ]] && continue
  target="$MODULES_DIR/$slug.md"
  if [[ ! -f "$target" ]]; then
    maybe_fail_index "index.md references '$slug' but $slug.md does not exist"
  else
    pass "index.md → $slug.md ✓"
  fi
done <<< "$LINK_SLUGS"

# Also check the reverse: every .md file (except index) is listed in the index
EXISTING_SLUGS=()
while IFS= read -r -d '' file; do
  slug="$(basename "$file" .md)"
  [[ "$slug" == "index" ]] && continue
  EXISTING_SLUGS+=("$slug")
done < <(find "$MODULES_DIR" -maxdepth 1 -name '*.md' -print0)

ALL_INDEXED_SLUGS="$LINK_SLUGS"
for slug in "${EXISTING_SLUGS[@]}"; do
  if ! grep -q "/docs/reference/modules/$slug)" "$INDEX"; then
    warn "$slug.md exists but is not listed in index.md"
  fi
done

echo ""
echo "--- Index links: ${ERRORS} error(s), ${WARNINGS} warning(s) ---"
echo ""

CUMULATIVE_ERRORS=$((CUMULATIVE_ERRORS + ERRORS))
CUMULATIVE_WARNINGS=$((CUMULATIVE_WARNINGS + WARNINGS))

# ---------------------------------------------------------------------------
# Section 3: Verify explicit module links inside module pages
# ---------------------------------------------------------------------------
echo "=== Module cross-link resolution ==="
echo ""

ERRORS=0
WARNINGS=0

while IFS= read -r -d '' file; do
  slug="$(basename "$file" .md)"
  [[ "$slug" == "index" ]] && continue

  page_links=$(grep -oP '/docs/reference/modules/\K[a-z0-9-]+(?=\))' "$file" 2>/dev/null || true)

  if [[ -z "$page_links" ]]; then
    continue
  fi

  while IFS= read -r linked_slug; do
    [[ -z "$linked_slug" ]] && continue
    target="$MODULES_DIR/$linked_slug.md"
    if [[ ! -f "$target" ]]; then
      fail "$slug.md links to missing module '$linked_slug'"
    else
      pass "$slug.md → $linked_slug.md ✓"
    fi
  done <<< "$page_links"
done < <(find "$MODULES_DIR" -maxdepth 1 -name '*.md' -print0)

echo ""
echo "--- Module links: ${ERRORS} error(s), ${WARNINGS} warning(s) ---"
echo ""

CUMULATIVE_ERRORS=$((CUMULATIVE_ERRORS + ERRORS))
CUMULATIVE_WARNINGS=$((CUMULATIVE_WARNINGS + WARNINGS))

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
