#!/usr/bin/env bash
set -euo pipefail

echo "=== nginz-website: test suite ==="

echo ""
echo "1. Astro type check…"
npx astro check

echo ""
echo "2. Worker type check…"
npx tsc --noEmit -p worker/tsconfig.json

echo ""
echo "3. Running tests…"
npx vitest run

echo ""
echo "=== All checks passed ==="
