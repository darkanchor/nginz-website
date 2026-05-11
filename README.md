# nginz-website

Public website for the **nginz family**: nginz (core), nginz-njs (policy), nginz-token (AI gateway).

This repo has **two deployables**:

- **Astro** builds the static website
- **Cloudflare Worker** owns `/api/*` and `/webhooks/*`

No Astro API routes live here. `astro.config.mjs` is `output: "static"`.

## Private repo docs

These are internal runbooks and are **not** shipped in the Astro site output under the current config unless someone moves them into `src/content/` or `public/`:

- [`CF.md`](./CF.md) — step-by-step Cloudflare setup
- [`PAYMENT.md`](./PAYMENT.md) — payment approach options and tradeoffs
- [`design.md`](./design.md) — broader product/design guardrails

## Prerequisites

- Node **22** is the safest choice because CI runs on Node 22
- npm
- Cloudflare account for deploys

## Quick start

Install dependencies and start both runtimes:

```bash
npm install
npm run dev
```

This starts:

- Astro on `http://127.0.0.1:4321`
- Worker on `http://127.0.0.1:8788`

Verify both:

```bash
curl "http://127.0.0.1:8788/api/health"
curl "http://127.0.0.1:4321/api/health"
```

Expected response:

```json
{
  "ok": true,
  "service": "nginz-website-worker"
}
```

### If port 8788 is already busy

This repo starts the Worker in the background. If a previous run did not exit cleanly:

```bash
kill $(lsof -ti:8788)
```

Then run `npm run dev` again.

## Local environment file

Create `.dev.vars` at the repo root if you need local Worker secrets:

```bash
SITE_URL="http://127.0.0.1:4321"
CONTACT_WEBHOOK_URL="https://example.invalid/contact"
PADDLE_WEBHOOK_SECRET="dev-placeholder"
```

Notes:

- `.dev.vars` is ignored by git
- the current repo only types `PADDLE_WEBHOOK_SECRET`, because payment integration is still a stub
- provider alternatives and payment strategy live in [`PAYMENT.md`](./PAYMENT.md)

## Commands that matter

| Command | What it does |
|---|---|
| `npm run dev` | Starts Astro + Worker together |
| `npm run dev:site` | Starts Astro only on `:4321` |
| `npm run dev:worker` | Starts Worker only on `:8788` |
| `npm run check` | Runs `astro check` |
| `npm run check:worker` | Runs Worker TypeScript check |
| `npm run test` | Runs `astro check` → Worker TS check → `vitest run` |
| `npm run test:watch` | Runs Vitest in watch mode |
| `npm run build` | Runs `astro build` then Worker TS validation |
| `npm run build:worker` | Dry-run Worker deploy with Wrangler |
| `npm run preview` | Serves the built Astro site locally |
| `npm run validate:modules` | Validates both native and scripted module docs |
| `npm run scaffold:module` | Scaffolds a module doc template |
| `npm run clean` | Removes `dist`, `.astro`, `.wrangler` |

## Preview, build, and test

### Build everything the repo can validate locally

```bash
npm run build
```

This does:

1. `astro build`
2. `tsc --noEmit -p worker/tsconfig.json`

Important: this **does not deploy** the Worker.

### Preview the built static site

```bash
npm run preview
```

Important: `npm run preview` only serves the built Astro site. If you want `/api/*` to work while previewing, run the Worker separately too.

### Run the main project checks

```bash
npm run test
```

That runs:

1. Astro checks
2. Worker TypeScript checks
3. Vitest

## Worker endpoints today

Current concrete Worker routes:

| Method | Path | Current status |
|---|---|---|
| `GET` | `/api/health` | real health route |
| `POST` | `/api/contact` | stub (`202`) |
| `POST` | `/api/payment` | stub (`202`) |
| `POST` | `/api/agent` | stub (`202`) |

Important:

- `/webhooks/*` is reserved for the Worker
- real payment webhook handlers are **not** implemented yet
- payment work is still design-stage, not production-ready

## Content system

Site content is published from `src/content/` only.

Collections live in `src/content/config.ts`:

- `products`
- `docs`
- `blog`

Routes are generated from those collections:

- product pages from `src/content/products/`
- docs pages from `src/content/docs/`
- blog pages from `src/content/blog/`

Private root docs like `CF.md`, `PAYMENT.md`, and this `README.md` are **not** published by the site under the current setup.

## Module documentation workflow

This repo has two module-doc families:

- native modules in `src/content/docs/reference/modules/`
- scripted modules in `src/content/docs/reference/scripted-modules/`

Useful commands:

```bash
npm run scaffold:module -- --slug my-module "My Module" "One-line description"
npm run validate:modules
npm run validate:modules -- --strict-index
```

For the full maintainer workflow, see:

- `scripts/README.md`
- `docs/maintainers/module-doc-iterations.md`

## CI truth

CI lives in `.github/workflows/ci.yml` and currently runs on:

- pushes to `main`
- pull requests

CI uses **Node 22** and runs:

1. `npm ci`
2. `npx astro check`
3. `npx tsc --noEmit -p worker/tsconfig.json`
4. `npx astro build`
5. smoke checks for built files

Important:

- CI currently does **not** run `vitest`
- CI currently does **not** run `npm run validate:modules`

If your change affects Worker behavior or module docs, run those locally yourself.

## Deployment summary

Production is a split deploy:

1. **Cloudflare Pages** serves the Astro static build
2. **Cloudflare Worker** serves `/api/*` and `/webhooks/*`

Fast summary:

```bash
npm run build
npx wrangler deploy worker/index.ts
```

Then configure your Cloudflare routes so:

- `/api/*` → Worker
- `/webhooks/*` → Worker
- everything else → Pages

For the click-by-click Cloudflare setup, read [`CF.md`](./CF.md).

## Payment summary

Payment setup is **not finished** in this repo.

Today:

- the Worker payment endpoint is a stub
- no real webhook flow exists
- the website pricing UI still contains checkout placeholders

Before implementing payments, read [`PAYMENT.md`](./PAYMENT.md).

## Known go-live fixes still pending

Before real production launch, check these files:

- `public/.well-known/agent-card.json` still contains `https://example.com`
- `public/robots.txt` still contains an `https://example.com` sitemap URL
- payment docs and flows are still placeholders/stubs

## Design reference

See [`design.md`](./design.md) for the broader architecture, product story, and original acceptance criteria.
