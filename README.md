# nginz-website

Public website for the **nginz family**: nginz (core), nginz-njs (policy), nginz-token (AI gateway).

**Architecture**: Astro (static content) + Cloudflare Worker (API runtime).

- Astro renders all HTML pages.
- Worker handles `/api/*` and `/webhooks/*` — no Astro API routes.
- Content is authored as Markdown in `src/content/` with typed collections.

## Quick start

```bash
npm install
npm run dev          # Astro on :4321 + Worker on :8788
```

## Project structure

```
public/                 Static assets and machine-readable files
  .well-known/            agent-card.json, security.txt
  llms.txt                Agent-ingestible index
  robots.txt              Crawl policy
src/
  content/                Typed content collections (Markdown)
    products/               nginz, nginz-njs, nginz-token
    docs/                   Getting started, guides
    blog/                   Blog posts
  layouts/                Astro layout components
  pages/                  Astro page routes
    products/               Index + [slug] (dynamic from collection)
    docs/                   Index + [...slug] (dynamic from collection)
    blog/                   Index + [...slug] (dynamic from collection)
  styles/                 Global CSS
worker/                 Cloudflare Worker runtime (TypeScript)
  index.ts                Route stubs: /api/health, /api/contact, /api/payment, /api/agent
  env.d.ts                Environment type declarations
  tsconfig.json           Worker-specific TypeScript config
scripts/                Dev, build, and test helpers
tests/                  Test suites
```

## Available scripts

| Command             | Description                               |
|---------------------|-------------------------------------------|
| `npm run dev`       | Start Astro and Worker together           |
| `npm run dev:site`  | Start Astro dev server on :4321           |
| `npm run dev:worker`| Start Worker dev server on :8788           |
| `npm run build`     | Build site and validate Worker            |
| `npm run preview`   | Preview built site locally                |
| `npm run check`     | Run Astro type checking                   |
| `npm run check:worker`| Run Worker TypeScript check             |
| `npm run test`      | Run Astro check, Worker check, and tests  |
| `npm run validate:modules` | Validate native module docs         |
| `npm run scaffold:module` | Scaffold a native module doc         |
| `npm run clean`     | Remove build artifacts                    |

## Content collections

Content is defined in `src/content/` with full TypeScript validation:

- **products** — title (string), license (string)
- **docs** — title (string)
- **blog** — title (string), date (optional Date)

Add new content by creating a Markdown file with frontmatter in the
appropriate directory. Routes are generated automatically.

### Products

Keep the files at `src/content/products/`. Routes at `/products/nginz`,
`/products/nginz-njs`, `/products/nginz-token` are preserved.

### Docs

Docs support nested paths. `src/content/docs/getting-started/overview.md`
becomes `/docs/getting-started/overview`.

### Blog

Blog posts at `src/content/blog/`. Each post becomes `/blog/:slug`.

## Worker API endpoints

The Worker runs independently on Cloudflare and handles dynamic logic:

| Method | Path             | Status | Purpose                    |
|--------|------------------|--------|----------------------------|
| GET    | `/api/health`    | 200    | Health check               |
| POST   | `/api/contact`   | 202    | Human/agent contact intake  |
| POST   | `/api/payment`   | 202    | Payment initiation stub     |
| POST   | `/api/agent`     | 202    | Structured agent contact    |

During local development, Astro proxies `/api/*` and `/webhooks/*` to the
Worker on port `8788`, so browser calls can use the same relative paths they
will use in production.

## Deployment

1. Build the static site: `npm run build`
2. Deploy `dist/` to Cloudflare Pages
3. Deploy `worker/` via Wrangler:
   ```bash
   npx wrangler deploy worker/index.ts
   ```

Ensure route rules are configured so `/api/*` and `/webhooks/*` route to the
Worker and everything else serves from Pages.

## Design reference

See [`design.md`](./design.md) for the full architecture plan, product story,
page-by-page design, payment module plan, and acceptance criteria.
