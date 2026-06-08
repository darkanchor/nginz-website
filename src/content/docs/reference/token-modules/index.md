---
title: nginz-token
description: "Short overview of the nginz-token AI gateway layer: multi-provider routing, token governance, cost attribution, prompt security, and policy-driven failover inside nginx."
---

# nginz-token

nginz-token is the AI gateway layer for nginz. It runs as native nginx modules and gives operators one place to route LLM traffic, resolve upstream credentials, enforce request and token budgets, record cost, inspect prompts, and handle controlled fallback across providers.

The design goal is simple: keep the control point inside nginx instead of pushing prompts, responses, and usage policy through an external SaaS proxy. The gateway understands LLM-specific concerns that stock nginx does not: model routing, token accounting, tenant scope, provider dialect boundaries, and prompt-side policy enforcement.

For the current release line, native routing is preferred, cross-provider translation is explicit and policy-controlled, and cache behavior is described conservatively. Endpoint dialect is declared by route configuration, not guessed from provider or model names. `llm-cache` is a real module boundary, but the immediate focus is cache eligibility, isolation, and bypass observability rather than broad semantic replay claims.

## Dialect translation

`llm-proxy` can bridge OpenAI-shaped clients to Anthropic Messages endpoints, and Anthropic-shaped clients to OpenAI-compatible endpoints, when the route explicitly declares the endpoint dialect. In cross-dialect paths, the request body is rewritten into the upstream dialect before proxying, and the upstream response can be normalized back to the client dialect on the way out. Native OpenAI and native Anthropic paths stay pass-through unless translation and normalization are intentionally configured.

This keeps the public contract precise: provider names such as `anthropic` or `deepseek-anthropic` are routing labels, not dialect inference. The endpoint dialect is a route property, and translation policy decides whether a cross-dialect path is acceptable.

If you want the broader product narrative, pricing, and positioning, see the [nginz-token product page](/products/nginz-token).

## License

nginz-token is **source-available under BSL 1.1**.

- You can read the code.
- You can evaluate it locally.
- You can use it for personal and non-commercial work.
- Commercial production use requires a license.

`nginz` and `nginz-njs` remain Apache 2.0. nginz-token is the commercial AI gateway layer.

## Module overview

All nginz-token modules ship under BSL 1.1:

- **llm-proxy** — multi-provider routing with explicit endpoint dialects, bidirectional OpenAI/Anthropic request translation, response normalization back to the client dialect, and per-request variable exposure for downstream modules
- **llm-auth** — provider credential resolution and upstream credential injection, with client/project/org scope selection
- **llm-metrics** — request counts, latency distributions, error rates, and bounded usage telemetry by provider, model, auth status, and tenant scope
- **llm-ratelimit** — per-user, per-key RPM/TPM rate limiting with shared-memory counters, in-flight reservation, and reconciliation from actual usage
- **llm-cost** — per-request cost calculation and PostgreSQL-backed cost event logging
- **llm-cache** — conservative cache policy surface for deciding eligibility, scope, and bypass reasons before heavier replay or semantic-cache features are attempted
- **llm-security** — prompt-side inspection and policy enforcement for PII, secrets, and prompt injection patterns, with org/project policy layering
- **llm-fallback** — policy-driven provider failover for configured retryable failures, with translation-aware replay policy

Together, these modules let nginx act as a bounded AI control plane instead of a blind HTTP pipe: route the request, apply tenant-aware policy, account for what happened, and keep the data path inside your own infrastructure.

## Deployment scenarios

Ready-to-run gateway configurations for common deployment patterns — from a single-team OpenAI endpoint with per-model quotas to multi-provider failover with independent spend caps. Each scenario includes a plain-language use case, the provisioning manifest, and the rendered nginx.conf. See the [deployment scenarios overview](/docs/reference/token-modules/scenarios) for the full set.

For early access or to discuss your team's requirements, [contact us](/contact).
