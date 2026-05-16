# AGENTS.md

## Runtime split
- This repo is two deployables: Astro static site + Cloudflare Worker. Astro owns all HTML pages; the Worker owns `/api/*` and `/webhooks/*` only.
- Do not add Astro API routes here. `astro.config.mjs` is `output: "static"`, and local dev proxies `/api` + `/webhooks` to the Worker on `127.0.0.1:8788`.
- Local ports are fixed by repo scripts/config: Astro `:4321`, Worker `:8788`.

### Dev servers that survive shell exit
```bash
# Start both (survives terminal close):
nohup npx wrangler dev worker/index.ts --port 8788 > /tmp/worker.log 2>&1 &
nohup npx astro dev --host --port 4321 > /tmp/astro.log 2>&1 &

# Kill both:
pkill -f "wrangler dev"; pkill -f "astro dev"
```

## Deployment
- Two separate deployables — deploy whichever changed:
  - **Worker** (`/api/*`, `/webhooks/*`): `npm run deploy` (builds + `npx wrangler deploy --env production`)
  - **Static site** (HTML, `agent-card.json`, `llms.txt`, etc.): `npx wrangler pages deploy dist --project-name nginz-website --branch main`
- Worker secrets are set once: `npx wrangler secret put <NAME> --env production`
- No git-connected auto-deploy — both are manual.

### Session-end deploy suggestion
- When a session's changes are complete and ready for production, always suggest which deployable(s) to deploy:
  - **Worker changed** (`worker/index.ts`, `worker/tsconfig.json`, Worker tests): `npm run deploy`
  - **Static site changed** (Astro pages, content, layouts, styles, `public/`, config): `npx wrangler pages deploy dist --project-name nginz-website --branch main`
  - **Both changed**: run both commands (Worker first, then Pages).
- Before suggesting deploy, run `npm run test` (or at minimum `npx astro check && npx astro build && npx tsc --noEmit -p worker/tsconfig.json`) to confirm the build is clean.

## Commands that matter
- `npm run dev` starts both runtimes via `scripts/dev.sh`: Worker in background, Astro in foreground. If dev shutdown goes badly, check for a leftover Worker on `:8788`.
- `npm run build` runs `astro build` first, then `tsc --noEmit -p worker/tsconfig.json`. It validates Worker TypeScript but does not deploy or bundle the Worker.
- `npm run test` runs, in order: `astro check` → `tsc --noEmit -p worker/tsconfig.json` → `vitest run`.
- Fast focused checks exist: `npm run check`, `npm run check:worker`, `npm run dev:site`, `npm run dev:worker`.

## CI truth
- CI is `.github/workflows/ci.yml` and runs on pushes to `main` and on pull requests.
- CI uses Node 22 and runs: `npm ci`, `npx astro check`, `npx tsc --noEmit -p worker/tsconfig.json`, `npx astro build`, then smoke-checks built files.
- CI currently does **not** run `vitest` and does **not** run `npm run validate:modules`, so run those manually when your change touches Worker behavior or module docs.

## Content + routing
- Content collections are defined in `src/content/config.ts`; frontmatter must match schema or Astro checks/build will fail.
- Collections are:
  - `products`: `title`, `license`, optional `category`, optional `tagline`
  - `docs`: `title`, optional `description`
  - `blogs`: `title`, optional `description`, `date`, optional `author` — categories are derived from directory names under `src/content/blogs/`
- Product routes are intentionally preserved at `/products/nginz`, `/products/nginz-njs`, and `/products/nginz-token`.
- Nested docs routes come directly from file paths under `src/content/docs/`.

## Worker boundary
- Worker entrypoint is `worker/index.ts`. Current concrete routes are:
  - `GET /api/health` → `200`
  - `POST /api/contact` → `202`
  - `POST /api/payment` → `202`
  - `POST /api/agent` → `202`
- `tests/worker.spec.ts` imports `worker/index.ts` directly and calls `worker.fetch(...)`. If you change Worker routing/response shape, update those tests.
- Declared Worker env bindings live in `worker/env.d.ts`: `SITE_URL`, `CONTACT_WEBHOOK_URL`, `PADDLE_WEBHOOK_SECRET`.

## Module-doc workflow
- This repo maintains two separate module doc families:
  - native modules: `src/content/docs/reference/modules/`
  - scripted modules: `src/content/docs/reference/scripted-modules/`
- `npm run validate:modules` validates **both** families, not just native modules.
- Required headings differ by family:
  - native: `## Directive reference`
  - scripted: `## Public Gleam API`
- Use `npm run validate:modules -- --strict-index` when index entries must all resolve.
- Use `npm run scaffold:module -- --slug <slug> "Title" "Description"` to start a page from the template.
- Source of truth for docs is upstream, not guesswork:
  - native docs: corresponding `nginz` module README
  - scripted docs: `nginz-njs` README/module README/public `pub fn` surface/integration tests
- Keep website docs less technical than upstream READMEs; the maintainer guide in `docs/maintainers/module-doc-iterations.md` is the repo’s doc-iteration playbook.

## Agent-facing static files
- Agent/crawler files live in `public/`: `llms.txt`, `.well-known/agent-card.json`, `.well-known/security.txt`, `robots.txt`.
- `astro.config.mjs` sets the site URL to `https://darkanchor.com`. Agent-facing files (`public/.well-known/agent-card.json`, `public/robots.txt`, `public/llms.txt`) should reference `darkanchor.com`, not `https://example.com`.

## High-signal gotchas
- The top-level `README.md` understates the docs tooling: the validator and maintainer guide already cover both native and scripted modules.
- `dist/`, `.astro/`, and `.wrangler/` are build artifacts/caches; do not edit them.
