---
title: nginz-token 1.30 is live
description: Eight native nginx modules, two self-serve tiers, four stability-tested gateway images, and live private-registry delivery.
date: 2026-07-14
author: darkanchor team
---

nginz-token 1.30 is live. It is an AI gateway that runs inside your nginx binary — not beside it, not in front of it, and not as a SaaS proxy that sees your prompts. Pro and Enterprise subscriptions are now available through our live self-serve checkout.

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
| **Monthly** | $149/mo | $399/mo |
| **Annual** | $1,499/yr | $3,999/yr |
| **Founding annual** | $999/yr | $2,499/yr |
| **Modules** | all 8 gateway modules | same modules + PostgreSQL backend, dashboard |
| **Private images** | 2 gateway images | 2 gateway images + PostgreSQL + provisioning |
| **Support** | community | email |

Founding annual pricing is available to every new annual checkout through **September 14, 2026 at 06:44 UTC**. There is no redemption cap. These are recurring annual prices: customers who subscribe at a founding price keep that renewal price while the subscription remains active. After the window closes, new annual checkouts automatically return to the standard annual prices.

The gateway images come in Debian trixie-slim (glibc) and Alpine 3.23 (musl) variants for `linux/amd64`. Alpine images are ~40% smaller. Trixie images lead on throughput at moderate concurrency. Enterprise also includes the PostgreSQL and provisioning images used by its dashboard stack.

## How access works

Paddle is the Merchant of Record and handles payment, tax, receipts, and subscription billing. After Paddle confirms a transaction, the delivery workflow issues private-registry access by email, along with a secure subscription-management link. Enterprise delivery also includes a stable customer serial UUID.

The checkout presents renewal, refund, privacy, and cancellation terms before purchase. Read the [commercial terms and refund policy](https://checkout.darkanchor.com/subscribe) for the complete rules.

## Stability

We ran 1.54 million requests across all four images under sustained load. The results: zero memory growth, zero unexpected errors, no throughput degradation. The full data is in the [stability report](/blogs/engineering/stability-gate-and-release).

## Why inside nginx

Because you already run nginx. You already know how to configure it, monitor it, and keep it alive. Adding an AI gateway that's also nginx means one binary to operate — not a separate service, not a SaaS proxy that sees your prompts, not a LuaJIT runtime bolted onto the side. The added latency is microseconds of JSON parsing and shared-memory bookkeeping, not a network hop to an external service.

## What's next

The cache module stays early-stage by design — we're not selling semantic cache magic. The fallback module gets smarter routing in subsequent releases. Everything else is available today.

<a href="https://checkout.darkanchor.com/" class="btn btn-primary" target="_blank" rel="noopener">View live pricing →</a>
<a href="/products/nginz-token" class="btn btn-secondary" style="margin-left:8px;">Read the product details →</a>
