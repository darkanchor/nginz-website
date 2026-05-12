#!/usr/bin/env bash
set -euo pipefail

echo "=== nginz-website: build ==="

echo "1. Building static site with Astro…"
npx astro build

echo ""
echo "2. Validating Worker TypeScript…"
npx tsc --noEmit -p worker/tsconfig.json

echo ""
echo "=== Build complete ==="
echo "Static site:   dist/"
echo "Worker source: worker/index.ts (deploy with wrangler deploy)"
