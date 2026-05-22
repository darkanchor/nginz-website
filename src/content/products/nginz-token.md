---
title: nginz-token
license: BSL 1.1
category: AI Gateway
tagline: AI gateway inside your nginx. Token-level rate limiting, per-user cost tracking, semantic caching, prompt security — no SaaS proxy.
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
- It cannot cache an LLM response and serve it to the next identical request.
- It cannot route a request to Anthropic when OpenAI is down, rewriting the request format on the fly.

nginx proxies bytes. nginz-token understands what those bytes mean for LLM traffic.

## Our approach

nginz-token runs as native and scripted modules inside your nginx binary — the same binary that's already proxying your traffic. When a client sends an LLM request, it arrives at nginx. Before it leaves your infrastructure, the gateway inspects it: who is this user, what model are they calling, are they within their token budget, does the prompt contain PII, should this request be served from cache? When the response returns, the gateway extracts the actual token usage, updates the budget, writes the cost record, and caches the response for next time.

All of this happens inside nginx. No separate service. No SaaS proxy. No data leaving your infrastructure. The added latency is microseconds of JSON parsing and shared-memory lookups — not a network hop to an external service.

### The request flow

Here's what happens when a client sends a chat completion request through nginz-token:

**1. Authenticate.** The client presents a Dark Anchor API key — not a real OpenAI or Anthropic key. The gateway validates it. If the key is revoked, the request stops here with a 401. The real provider key lives in nginx config or a vault. The client never sees it.

**2. Authorize.** The gateway checks what this user is allowed to do. Can they use GPT-4o, or only GPT-4o-mini? Is their team's monthly budget exhausted? Are they calling during allowed hours? This is the policy layer — the same composable authorization engine from nginz-njs, applied to LLM access.

**3. Check the token budget.** Before the request reaches the provider, the gateway estimates how many tokens this request will consume. It reads the `messages` array from the request body and applies a fast approximation — character count divided by four gives a rough input token estimate. It checks the user's token-per-minute budget in shared memory. If the estimate plus current in-flight usage exceeds the limit, the gateway returns 429 with a `Retry-After` header. If within budget, it reserves the estimated tokens and lets the request through.

**4. Screen the prompt.** The gateway inspects the request body for PII patterns — email addresses, phone numbers, credit card numbers, API keys. If it finds them, it can block the request, redact the fields, or log a warning depending on your policy. It also checks for prompt injection patterns — attempts to override system instructions or extract hidden context. This is a pattern-matching check in the body filter, not a call to an external scanning service.

**5. Route to the right provider.** The client asked for `gpt-4o`. The gateway rewrites the request to OpenAI's format, injects the real API key into the Authorization header (or `x-api-key` for Anthropic), and sends it upstream. If the request asked for a model that the gateway routes to Anthropic, it rewrites the request body from OpenAI format to Anthropic format — mapping `messages` with roles to Anthropic's `content` structure, adding the required `max_tokens` field, moving the system prompt to the top-level `system` field. The client code only ever speaks OpenAI format. Provider choice is a routing rule in nginx config.

**6. Stream the response, watching for usage.** If the client requested streaming, the gateway passes each SSE chunk through immediately — no buffering. It watches for the final chunk that contains the `usage` block (OpenAI with `stream_options: {"include_usage": true}`) or the `message_delta` event (Anthropic). When it sees the usage data, it extracts the actual prompt and completion token counts.

**7. Reconcile the budget.** The actual token count from the response replaces the estimate. The gateway updates the user's token budget in shared memory, subtracting the actual tokens and releasing the in-flight reservation. If the actual count was higher than estimated, the user might tip over their limit — but only for this request, and only by a small margin. The next request will see the updated budget and act accordingly.

**8. Log the cost.** The gateway calculates the cost: prompt tokens × input rate + completion tokens × output rate, using the pricing table in nginx config. It writes a row to PostgreSQL via an asynchronous, non-blocking connection — the request doesn't wait for the database. If the connection pool is saturated, the write is queued or dropped with a warning. Cost tracking is best-effort, not blocking.

**9. Cache the response.** If semantic caching is enabled, the gateway extracts the prompt embedding from a local sidecar (a small ONNX model running on the host, communicating over a Unix socket), stores the response and its embedding in pgvector, and returns the response to the client. On the next identical or near-identical request, the cache lookup happens at step 0 — before any upstream call is made. The gateway returns the cached response in microseconds.

### What you can do with this

**Ask "who spent what" and get an answer.** Every request writes cost data — user, team, model, tokens consumed, cost in dollars — to PostgreSQL. You query it. You build dashboards on it. Your finance team gets per-department breakdowns. Your engineering director knows which project drove the $40K. You stop guessing.

**Prevent the $3,000 overnight bill.** Per-user token-per-minute budgets. Per-team monthly quotas. Hard caps that return 429 instead of racking up provider charges. A runaway job burns through its budget in minutes and stops — it doesn't burn through your credit card for eight hours while everyone sleeps.

**Rotate a provider key once, not everywhere.** The real OpenAI key lives in nginx config. The 50 services that call the LLM use Dark Anchor keys. When you rotate the provider key, you edit one config file and reload. The services never know. A Dark Anchor key can be revoked in one place and the user is cut off immediately — no hunting through repositories and `.env` files.

**Pass compliance review.** PII filtering happens at the gateway. Every prompt passes through the filter before it leaves your network. Not every application has to implement it. Not every team has to remember to add the check. It's one place, enforced uniformly.

**Switch providers without changing code.** The client sends an OpenAI-format request to `model: "claude-sonnet-4-5"`. The gateway routes it to Anthropic, rewrites the format, and normalizes the response back to OpenAI format. The client doesn't know it just called Anthropic. If OpenAI has an outage, the fallback module routes to Anthropic automatically. If a new provider launches with better pricing, you add a routing rule. Zero application changes.

**Serve cached responses in microseconds.** When two users ask the same question within the cache window, the second response comes from cache — no API call, no latency, no cost. For customer-facing chatbots where the same "what are your business hours?" query arrives hundreds of times a day, this alone can cut your API bill by 30 to 70 percent.

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

All nginz-token modules ship under BSL 1.1:

- **llm-proxy** — multi-provider routing with transparent request and response format rewriting
- **llm-auth** — API key validation and provider credential injection
- **llm-metrics** — request counts, latency distributions, error rates, and usage telemetry by model and identity
- **llm-ratelimit** — per-user, per-key RPM and TPM rate limiting with shared-memory counters, in-flight reservation, and reconciliation from actual usage
- **llm-cost** — per-request cost calculation and asynchronous PostgreSQL logging, with configurable pricing tables per model
- **llm-cache** — semantic response caching via embedding similarity: local ONNX embedding sidecar, pgvector similarity search, streaming response replay
- **llm-security** — prompt injection detection and PII filtering at the gateway, before prompts leave your infrastructure
- **llm-fallback** — provider failover and load-aware, cost-aware, latency-aware model switching
- **Dashboard** — web UI for cost trends, usage by team, quota status, and model performance

### Pricing

nginz-token is sold in two self-serve tiers plus a custom tier:

| Tier | Price | What you get |
|------|-------|--------------|
| **Pro** | **$1,499/yr** or **$149/mo** | nginz-token gateway modules under BSL 1.1 |
| **Enterprise** | **$3,999/yr** or **$399/mo** | Everything in Pro, plus dashboard, PostgreSQL schema/tooling, and email support |
| **Custom** | Talk to us | SLA, priority support, custom packaging, and enterprise requirements |

Founding pricing for the first 20 customers: **$999/yr Pro** and **$2,499/yr Enterprise** for the first 12 months.

The free layer is not inside nginz-token. The free layer is the rest of the stack:

- **nginz** — Apache 2.0 native nginx modules
- **nginz-njs** — Apache 2.0 scripted policy modules

Those projects are the funnel. nginz-token is the commercial AI gateway product.

## Why inside nginx, not a separate service

Running the AI gateway as nginx modules — rather than as a separate proxy service or SaaS — matters for three reasons.

**Data stays yours.** Every prompt, every response, every user interaction passes through nginx and stays inside your infrastructure. A SaaS proxy sees your prompts. For companies in healthcare, finance, legal, or any industry with data residency requirements, this isn't negotiable. nginz-token runs where nginx runs — inside your VPC, your data center, your Kubernetes cluster. No third party sees the traffic.

**Zero added latency from a proxy hop.** A SaaS proxy adds a network round trip — 30 to 200 milliseconds — between your application and the LLM provider. nginz-token adds the latency of a JSON parse and a shared-memory lookup — microseconds. For an API that already takes seconds to return, every millisecond of overhead you can remove improves the user experience. For streaming responses, where the user sees tokens appear one by one, proxy latency means the first token arrives noticeably later.

**One binary to operate.** You already run nginx. You already know how to configure it and already have playbooks for it. Adding an AI gateway that's also nginx means one process to manage, not two. One deployment artifact. No new infrastructure to learn, no new failure mode to troubleshoot.

## Availability

nginz-token is in active development. The full product ships under BSL 1.1, source-visible for evaluation and non-commercial use, with commercial production use licensed.

[Contact us](/contact) if you want early access or need to discuss your team's requirements.
