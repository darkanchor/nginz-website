#!/usr/bin/env bash
set -euo pipefail

echo "=== nginz-website: build ==="

echo "1. Generating llms.txt from content collections…"
node scripts/generate-llms.mjs

echo ""
echo "2. Building static site with Astro…"
npx astro build

echo ""
echo "3. Validating Worker TypeScript…"
npx tsc --noEmit -p worker/tsconfig.json

echo ""
echo "=== Build complete ==="
echo "Static site:   dist/"
echo "Worker source: worker/index.ts (deploy with wrangler deploy)"
