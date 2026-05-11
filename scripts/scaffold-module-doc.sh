#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scaffold-module-doc.sh — Create a new module documentation page from template.
#
# Usage:
#   ./scripts/scaffold-module-doc.sh "Module Name" "Brief description" [slug]
#   ./scripts/scaffold-module-doc.sh --slug custom-slug "Module Name" "Brief description"
#
# If arguments are omitted the script prompts interactively.
#
# The new file is written to src/content/docs/reference/modules/<slug>.md
# and opened in $EDITOR if the variable is set.
# ---------------------------------------------------------------------------
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$BASE_DIR/scripts/templates/module-doc.md"
TARGET_DIR="$BASE_DIR/src/content/docs/reference/modules"

die() { echo "❌ $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  bash ./scripts/scaffold-module-doc.sh "Module Name" "Brief description" [slug]
  bash ./scripts/scaffold-module-doc.sh --slug custom-slug "Module Name" "Brief description"

Notes:
  - If slug is omitted, it is derived from the module name.
  - For native nginz modules, pass an explicit slug when the customer-facing
    title differs from the module directory name (for example: "JWT Authentication" -> jwt).
EOF
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\&/]/\\&/g'
}

# --- Parse arguments -------------------------------------------------------
SLUG_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug)
      [[ $# -lt 2 ]] && die "--slug requires a value"
      SLUG_OVERRIDE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

MODULE_NAME="${1:-}"
MODULE_DESC="${2:-}"
POSITIONAL_SLUG="${3:-}"

if [[ -z "$MODULE_NAME" ]]; then
  read -r -p "Module name (e.g. Rate Limiting): " MODULE_NAME
fi
if [[ -z "$MODULE_DESC" ]]; then
  read -r -p "Short description (one line): " MODULE_DESC
fi

# --- Derive slug -----------------------------------------------------------
SLUG_SOURCE="$SLUG_OVERRIDE"
if [[ -z "$SLUG_SOURCE" && -n "$POSITIONAL_SLUG" ]]; then
  SLUG_SOURCE="$POSITIONAL_SLUG"
fi

if [[ -n "$SLUG_SOURCE" ]]; then
  SLUG="$SLUG_SOURCE"
else
  SLUG="$(echo "$MODULE_NAME" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
fi

[[ -z "$SLUG" ]] && die "Unable to derive slug from module name"
[[ "$SLUG" =~ ^[a-z0-9-]+$ ]] || die "Slug must match ^[a-z0-9-]+$"

TARGET="$TARGET_DIR/$SLUG.md"

# --- Safety check ----------------------------------------------------------
if [[ ! -f "$TEMPLATE" ]]; then
  die "Template not found at $TEMPLATE"
fi

if [[ -f "$TARGET" ]]; then
  die "Target already exists: $TARGET"
fi

# --- Scaffold --------------------------------------------------------------
cp "$TEMPLATE" "$TARGET"

# Replace the few auto-derivable placeholders; most are left as-is for the
# author to fill manually since they require judgment (use-cases, directives).
ESCAPED_NAME="$(escape_sed_replacement "$MODULE_NAME")"
ESCAPED_DESC="$(escape_sed_replacement "$MODULE_DESC")"
sed -i "s/\$MODULE_NAME/$ESCAPED_NAME/g" "$TARGET"
sed -i "s/\$MODULE_DESCRIPTION/$ESCAPED_DESC/g" "$TARGET"

echo "✅ Created: $TARGET"
echo ""
echo "   Next steps:"
echo "   1. Fill in the remaining \$PLACEHOLDERs in the file."
echo "   2. Add the module to the index: src/content/docs/reference/modules/index.md"
echo "   3. Run validation: npm run validate:modules"
echo "   4. Preview the page: npm run dev"
echo ""

if [[ -n "${EDITOR:-}" ]]; then
  "$EDITOR" "$TARGET"
else
  echo "   (Set \$EDITOR to auto-open new files.)"
fi
