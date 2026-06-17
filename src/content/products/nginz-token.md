---
title: nginz-token
license: BSL 1.1
category: AI Gateway
tagline: AI gateway inside your nginx. Token-level rate limiting, per-user cost tracking, bounded cache policy, prompt security — no SaaS proxy.
---

# nginz-token

## The concern

Your engineering team adopted LLM APIs. OpenAI, Anthropic, maybe a local model. It started with one API key in one `.env` file. A month later, five teams are using it. Three months later, the CFO asks a question nobody can answer: **who spent the $40,000 this month?**

This is the organizational wake-up call that hits every company running LLMs in production. The problems aren't technical — nginx proxies the bytes just fine. The problems are organizational:

**You can't answer "who spent what."** The OpenAI invoice says $40K. It doesn't say which team spent it, which project drove it, or which model was the expensive one. Your engineering director needs a per-team cost breakdown for the quarterly review. Your finance team needs to charge costs back to departments. You have nothing except the provider's aggregate number and a spreadsheet someone updates manually.

**One runaway job can burn thousands overnight.** A junior engineer's test loop calls GPT-4o 10,000 times before anyone notices. A misconfigured retry logic on a background job fans out to 50 concurrent workers, each hitting the API at full speed. By morning, the bill is $3,000. Stock nginx doesn't count tokens. It can't tell the difference between a 10-token health check and a 10,000-token document analysis. Both are just bytes.

**API keys are scattered across every repository and `.env` file.** When you need to rotate the OpenAI key — because someone committed it to a public repo, or a contractor left the company — you're chasing down every place that key lives. Some places you'll miss. The old key will still work for weeks after you think you revoked it. And every team that has the real OpenAI key can use any model at any volume with no guardrails.

**Legal says you can't use LLMs until you filter PII.** Your compliance team wants prompt content screened for email addresses, phone numbers, and API keys before it leaves your infrastructure. Your security team wants prompt injection attempts detected and blocked. These checks need to happen at the infrastructure layer — not in every application that calls an LLM, where one missed check is a compliance incident.

**You're locked into one provider without meaning to be.** Every integration uses OpenAI's API format because that's what the first prototype used. If OpenAI has an outage, you have no automatic failover. If Anthropic launches a cheaper model, migrating means rewriting every integration. You want provider choice to be a config change, not a code change.

**The proxy you'd use to solve this is itself a problem.** You could route all LLM traffic through a SaaS proxy — Portkey, Helicone, or the cloud provider's gateway. But that means your prompts, your responses, your users' data flow through a third party. For any company with data residency requirements, legal review, or simply a preference not to send prompts to an external service, this is a non-starter. And the proxy adds 30 to 200 milliseconds of latency — for a service that sits between you and an API that's already taking seconds to respond, every millisecond counts.

**You're building all of this yourself.** Cost tracking becomes a database table and a cron job that parses logs. Rate limiting becomes a Redis counter with hand-rolled window logic. Key management becomes a vault service and a middleware library. Prompt filtering becomes a regex in an API gateway plugin. Six months in, you're maintaining an LLM infrastructure platform instead of building your product.

## What stock nginx is missing

nginx can proxy HTTP requests to an LLM provider. That's the beginning and the end of what it does out of the box.

- It cannot read the request body to extract the model name and estimate token count.
- It cannot parse the streaming response to extract actual usage.
- It cannot enforce per-user token budgets — nginx rate limiting counts requests, not tokens.
- It cannot write cost records to a database.
- It cannot detect prompt injection or filter PII from request bodies.
- It cannot route a request to Anthropic when OpenAI is down, rewriting the request format on the fly.

nginx proxies bytes. nginz-token understands what those bytes mean for LLM traffic.

## Our approach

nginz-token runs as native modules inside your nginx binary — the same binary that's already proxying your traffic. When a client sends an LLM request, it arrives at nginx. Before it leaves your infrastructure, the gateway inspects it: which client, project, or org context does this request belong to, what model are they calling, are they within their request and token budget, does the prompt contain PII, and does this request fall into a cache-safe class the gateway can reason about? When the response returns, the gateway extracts the actual token usage, reconciles the budget, writes the cost record, and records the cache-relevant outcome for future bounded reuse work.

All of this happens inside nginx. No separate service. No SaaS proxy. No data leaving your infrastructure. The added latency is microseconds of JSON parsing and shared-memory lookups — not a network hop to an external service.

### The request flow

Here's what happens when a client sends a chat completion request through nginz-token:

**1. Resolve provider credentials centrally.** The client never needs the real OpenAI or Anthropic key. The gateway resolves the upstream provider credential from nginx config, environment, or file-backed secrets and injects it just before proxying upstream. Teams rotate one provider credential in one place instead of chasing it through every repository and `.env` file.

**2. Scope the request.** The gateway maps the request onto a client, project, or org boundary using nginx variables and location policy. That scope becomes the basis for credential selection, cost attribution, metrics labeling, and shared gateway controls.

**3. Check the request and token budget.** Before the request reaches the provider, the gateway enforces request-per-minute and token-per-minute limits in shared memory. It reserves a configured token budget pre-flight, then reconciles against the actual usage extracted from the response. If the caller is already over budget, the gateway returns 429 before the upstream call goes out.

**4. Screen the prompt.** The gateway inspects the request body for PII patterns — email addresses, phone numbers, credit card numbers, API keys. If it finds them, it can block the request, redact the fields, or log a warning depending on your policy. It also checks for prompt injection patterns — attempts to override system instructions or extract hidden context. This is a pattern-matching check in the body filter, not a call to an external scanning service.

**5. Route to the right provider.** The gateway resolves the requested model onto a configured upstream route, injects the real provider credential, and sends the request upstream in the endpoint dialect declared by that route. Provider and model names are labels, not dialect detection rules. Native paths stay native; when you intentionally configure a cross-dialect route, the gateway can translate request bodies between OpenAI chat and Anthropic Messages format, then normalize the upstream response back to the client dialect on the way out. Translation is explicit and policy-controlled, so provider choice stays a routing rule in nginx config instead of a code rewrite.

**6. Stream the response, watching for usage.** If the client requested streaming, the gateway passes each SSE chunk through immediately — no buffering. It watches for the final chunk that contains the `usage` block (OpenAI with `stream_options: {"include_usage": true}`) or the `message_delta` event (Anthropic). When it sees the usage data, it extracts the actual prompt and completion token counts.

**7. Reconcile the budget.** The actual token count from the response replaces the estimate. The gateway updates the user's token budget in shared memory, subtracting the actual tokens and releasing the in-flight reservation. If the actual count was higher than estimated, the user might tip over their limit — but only for this request, and only by a small margin. The next request will see the updated budget and act accordingly.

**8. Log the cost.** The gateway calculates the cost: prompt tokens × input rate + completion tokens × output rate, using the pricing table in nginx config. It can write a row to PostgreSQL with the canonical accounting fields — provider, model, requested routing, token totals, org/project/client scope, and cost unit — so finance and engineering can query the same ledger.

**9. Record cache eligibility conservatively.** The cache layer is intentionally narrow today. The immediate goal is to make cache eligibility, isolation boundaries, and bypass reasons explicit so operators can see where reuse is safe. We are not positioning first-generation `llm-cache` as general semantic replay magic.

### What you can do with this

**Ask "who spent what" and get an answer.** Every request can write cost data — org, project, client, model, requested vs effective routing, tokens consumed, cost unit, and total cost — to PostgreSQL. You query it. You build dashboards on it. Your finance team gets per-department breakdowns. Your engineering director knows which project drove the $40K. You stop guessing.

**Prevent the $3,000 overnight bill.** Per-user token-per-minute budgets. Per-team monthly quotas. Hard caps that return 429 instead of racking up provider charges. A runaway job burns through its budget in minutes and stops — it doesn't burn through your credit card for eight hours while everyone sleeps.

**Rotate a provider key once, not everywhere.** The real OpenAI or Anthropic key lives in nginx config, environment, or a file-backed secret source. The 50 services that call the gateway never need to embed the upstream provider key directly. When you rotate the provider key, you update one place and reload — no hunting through repositories and `.env` files.

**Give compliance one control point.** PII filtering happens at the gateway, before prompts leave your network. Not every application has to implement it separately, and not every team has to remember to add the check. It gives compliance and security teams one place to review, tune, and enforce prompt-side guardrails.

**Switch providers without changing code.** If your applications already speak a provider's native API shape, the gateway can keep that path native and move the route underneath them. If your callers and the target endpoint speak different dialects, the proxy can translate the request and normalize the response while preserving accounting and routing variables for downstream modules. For configured retryable failures, the fallback layer can move the request to a secondary provider before the response is committed, subject to the replay and translation policy you set. If a new provider launches with better pricing, you adjust routing policy instead of rewriting every caller.

**Make cache behavior explicit before you trust it.** LLM caching is easy to oversell and easy to get wrong. Prompt meaning is fuzzy, provider behavior differs, tool use introduces side effects, streaming complicates replay, and cross-tenant reuse can become a correctness or privacy bug. Our current `llm-cache` direction is conservative: define which requests are even eligible for cache consideration, isolate reuse boundaries, and surface explicit bypass reasons. That gives operators something measurable and defensible instead of a vague “AI cache” claim.

### Licensing

nginz-token is one product under **BSL 1.1**. It is **source-available**, not Apache-licensed open source.

That means:

- You can read the source.
- You can evaluate it locally.
- You can use it for personal and non-commercial work.
- If you use it in production for a business purpose, you need a license.

We keep this boundary simple on purpose. `nginz` and `nginz-njs` are Apache 2.0. `nginz-token` is the commercial AI gateway layer.

We do **not** split nginz-token into a free Apache subset and a paid subset. The whole value of the gateway is that routing, identity, token governance, cost attribution, prompt security, failover, and management surfaces work together as one product.

BSL is also not a private binary-only model. Buyers can audit what they run. That matters for infrastructure software.

### Module catalog

All eight modules ship in both Pro and Enterprise. The difference is operational: Pro is self-hosted (you run the DB and observability stack), Enterprise bundles PostgreSQL, dashboard, and email support.

- **llm-proxy** — multi-provider routing with explicit endpoint dialects, bidirectional OpenAI/Anthropic request translation, response normalization back to the client dialect, and routing variables for downstream modules
- **llm-auth** — provider credential resolution and upstream credential injection, with client/project/org scope selection
- **llm-metrics** — request counts, latency distributions, error rates, and bounded usage telemetry by provider, model, auth status, and tenant scope
- **llm-ratelimit** — per-user, per-key RPM and TPM rate limiting with shared-memory counters, in-flight reservation, and reconciliation from actual usage
- **llm-cost** — per-request cost calculation and cost event emission, with configurable pricing tables per model. Enterprise adds the PostgreSQL backend and dashboard for turnkey aggregated reporting.
- **llm-cache** — early-stage cache policy surface for eligibility, isolation, and bypass rules; not positioned today as a general semantic response cache
- **llm-security** — prompt-side inspection and policy enforcement for PII, secrets, and prompt injection patterns, with org/project policy layering and response-side controls evolving separately
- **llm-fallback** — policy-driven provider failover for configured retryable failures, with translation-aware replay policy

### Pricing

nginz-token is sold in two self-serve tiers plus a custom tier:

| Tier | Price | What you get |
|------|-------|--------------|
| **Pro** | **$1,499/yr** or **$149/mo** | All 8 gateway modules. Self-hosted: you run the DB and observability stack. |
| **Enterprise** | **$3,999/yr** or **$399/mo** | Same modules, plus PostgreSQL backend, dashboard, and email support. |
| **Custom** | Talk to us | SLA, priority support, custom packaging, and enterprise requirements |

## Live demo

If you want to see the dashboard and operator surface before talking to us, open the live product teaser at [nginz.dev](https://nginz.dev/).

## Why inside nginx, not a separate service

Running the AI gateway as nginx modules — rather than as a separate proxy service or SaaS — matters for three reasons.

**Data stays yours.** Every prompt, every response, every user interaction passes through nginx and stays inside your infrastructure. A SaaS proxy sees your prompts. For companies in healthcare, finance, legal, or any industry with data residency requirements, this isn't negotiable. nginz-token runs where nginx runs — inside your VPC, your data center, your Kubernetes cluster. No third party sees the traffic.

**Avoid the extra proxy hop.** A SaaS proxy adds a network round trip — 30 to 200 milliseconds — between your application and the LLM provider. nginz-token keeps the control point inside nginx, so the added work is local parsing and shared-memory bookkeeping rather than another external service hop. For an API that already takes seconds to return, that difference matters. For streaming responses, it helps the first token arrive sooner.

**One binary to operate.** You already run nginx. You already know how to configure it and already have playbooks for it. Adding an AI gateway that's also nginx means one process to manage, not two. One deployment artifact. No new infrastructure to learn, no new failure mode to troubleshoot.

## Availability

nginz-token 1.30 is shipping. All eight gateway modules — proxy, auth, metrics, ratelimit, cost, cache, security, and fallback — are stable and ready for production. The images have passed sustained-load stability testing: zero memory growth, zero unexpected errors, no throughput degradation across 1.54 million requests.

The product is sold under BSL 1.1, source-visible for evaluation and non-commercial use, with commercial production use licensed. Two tiers are available today:

- **Pro** ($1,499/yr): all 8 gateway modules. You run your own database and observability stack for cost aggregation, metrics retention, and dashboards.
- **Enterprise** ($3,999/yr): same 8 modules, plus a bundled PostgreSQL backend with pre-built cost aggregation, dashboard, and email support.

Both tiers ship as Docker images in two base OS variants: Debian trixie-slim (glibc) and Alpine 3.23 (musl).

[Contact us](/contact) to get started or discuss your team's requirements.
