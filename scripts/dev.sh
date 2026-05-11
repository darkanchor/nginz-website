#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ -n "${WORKER_PID:-}" ]]; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "=== nginz-website: dev environment ==="
echo ""
echo "Starting Astro dev server on :4321"
echo "Starting Worker dev server on :8788"
echo ""
echo "Architecture:"
echo "  Astro  → static HTML pages (everything except /api/* and /webhooks/*)"
echo "  Worker → API runtime for /api/* and /webhooks/*"
echo ""

# Start the Worker in the background
echo "Starting Worker (port 8788)…"
npx wrangler dev worker/index.ts --port 8788 &
WORKER_PID=$!

# Start Astro in the foreground
echo "Starting Astro (port 4321)…"
npx astro dev --host --port 4321
