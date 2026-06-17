---
title: nginz-token 1.30 — the AI gateway for nginx is shipping
description: Eight modules. Two tiers. Four Docker images. Zero memory growth, zero errors, ready for production.
date: 2026-06-17
author: darkanchor team
---

nginz-token 1.30 is shipping. It's an AI gateway that runs inside your nginx binary — not beside it, not in front of it, not as a SaaS proxy you have to trust with your prompts.

## What ships

Eight native modules loaded into stock nginx. They handle the things your LLM provider invoice can't answer:

- **Who spent what.** Per-request cost attribution to org, project, and client. Enterprise ships with PostgreSQL and a dashboard for turnkey cost reporting. Pro emits the same cost events — teams wire them into their own observability stack. Either way, you stop guessing which project drove the $40,000.
- **How much they can spend.** Token-per-minute and request-per-minute budgets enforced in shared memory before the upstream call goes out. A runaway job burns through its budget and stops — it doesn't burn through your credit card overnight.
- **Where the provider keys live.** Credentials resolved from nginx config and injected at proxy time. Your 50 services never touch the real OpenAI key. When you rotate it, you update one place.
- **What the prompts contain.** PII and secrets scanning at the edge, before prompts leave your infrastructure. Prompt injection detection. One control point for compliance.
- **Which provider handles this request.** Route by model label. Translate between OpenAI and Anthropic formats when the caller and endpoint speak different dialects. Fail over to a secondary provider on retryable errors, with replay policy you control.
- **Whether the response matters for cache.** Early-stage cache eligibility and isolation rules. Not semantic replay magic — explicit, defensible policy about which requests are even candidates.

## Two tiers

| | Pro | Enterprise |
|---|---|---|
| **Price** | $1,499/yr | $3,999/yr |
| **Modules** | all 8 gateway modules | same modules + PostgreSQL backend, dashboard |
| **Dashboard** | — | ✓ |
| **PostgreSQL tooling** | — | ✓ |
| **Support** | community | email |

Both tiers ship as Docker images in two base OS variants: Debian trixie-slim (glibc) and Alpine 3.23 (musl). Alpine images are ~40% smaller. Trixie images lead on throughput at moderate concurrency. Pick the tradeoff that fits your environment.

## Stability

We ran 1.54 million requests across all four images under sustained load. The results: zero memory growth, zero unexpected errors, no throughput degradation. The full data is in the [stability report](/blogs/engineering/stability-gate-and-release).

## Why inside nginx

Because you already run nginx. You already know how to configure it, monitor it, and keep it alive. Adding an AI gateway that's also nginx means one binary to operate — not a separate service, not a SaaS proxy that sees your prompts, not a LuaJIT runtime bolted onto the side. The added latency is microseconds of JSON parsing and shared-memory bookkeeping, not a network hop to an external service.

## What's next

The cache module stays early-stage by design — we're not selling semantic cache magic. The fallback module gets smarter routing in subsequent releases. Everything else is production-ready today.

<a href="/products/nginz-token" class="btn btn-primary">See the full product page →</a>
