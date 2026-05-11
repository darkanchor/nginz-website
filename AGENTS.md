# AGENTS.md

## Runtime split
- This repo is two deployables: Astro static site + Cloudflare Worker. Astro owns all HTML pages; the Worker owns `/api/*` and `/webhooks/*` only.
- Do not add Astro API routes here. `astro.config.mjs` is `output: "static"`, and local dev proxies `/api` + `/webhooks` to the Worker on `127.0.0.1:8788`.
- Local ports are fixed by repo scripts/config: Astro `:4321`, Worker `:8788`.

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
  - `blog`: `title`, optional `description`, optional `author`, optional `date`
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
- `astro.config.mjs` sets the site URL to `https://nginz.dev`, but `public/.well-known/agent-card.json` and `public/robots.txt` still contain `https://example.com` placeholders. Do not assume those files are production-correct without checking.

## High-signal gotchas
- The top-level `README.md` understates the docs tooling: the validator and maintainer guide already cover both native and scripted modules.
- `dist/`, `.astro/`, and `.wrangler/` are build artifacts/caches; do not edit them.
