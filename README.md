# nginz-website

Public website for the [nginz](https://github.com/darkanchor/nginz) product family by [darkanchor](https://github.com/darkanchor).

Astro static site + Cloudflare Worker API. Hosted on Cloudflare Pages.

```bash
npm install
npm run dev     # http://localhost:4321 + Worker on :8788
npm run build   # static build + Worker type-check
npm run test    # astro check + worker type-check + vitest
```

## Deploy

Two separate deployables — deploy whichever changed:

```bash
# Worker (API routes: /api/*, /webhooks/*)
npm run deploy                 # builds + deploys Worker to production
# or manually:
npx wrangler deploy --env production

# Static site (HTML pages, agent-card.json, llms.txt, etc.)
npx wrangler pages deploy dist --project-name nginz-website --branch main
```

> Worker secrets (`CONTACT_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, etc.) are set once via:
> `npx wrangler secret put <NAME> --env production`
