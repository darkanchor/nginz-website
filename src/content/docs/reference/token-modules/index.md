---
title: nginz-token
description: "Short overview of the nginz-token AI gateway layer: multi-provider routing, token governance, cost attribution, prompt security, and policy-driven failover inside nginx."
---

# nginz-token

nginz-token is the AI gateway layer for nginz. It runs as native nginx modules and gives operators one place to route LLM traffic, resolve upstream credentials, enforce request and token budgets, record cost, inspect prompts, and handle controlled fallback across providers.

The design goal is simple: keep the control point inside nginx instead of pushing prompts, responses, and usage policy through an external SaaS proxy. The gateway understands LLM-specific concerns that stock nginx does not: model routing, token accounting, tenant scope, provider dialect boundaries, and prompt-side policy enforcement.

nginz-token 1.30 has passed sustained-load stability testing across all four Docker images (enterprise/pro, trixie/alpine): zero memory growth, zero unexpected errors, no throughput degradation across 1.54 million requests. See the [stability report](/blogs/engineering/stability-gate-and-release) for the full data.

For the broader product narrative, pricing, and positioning, see the [nginz-token product page](/products/nginz-token).

## License

nginz-token is **source-available under BSL 1.1**.

- You can read the code.
- You can evaluate it locally.
- You can use it for personal and non-commercial work.
- Commercial production use requires a license.

`nginz` and `nginz-njs` remain Apache 2.0. nginz-token is the commercial AI gateway layer.

## Module overview

All eight modules ship in both Pro and Enterprise. The only difference is operational: Pro is self-hosted, Enterprise bundles the PostgreSQL backend, dashboard, and email support.

- **llm-proxy** — multi-provider routing with explicit endpoint dialects, bidirectional OpenAI/Anthropic request translation, and response normalization back to the client dialect. Provider names are routing labels, not dialect inference — the endpoint dialect is a route property, and translation policy decides whether a cross-dialect path is acceptable. Native paths stay pass-through. Also exposes per-request routing variables for downstream modules.
- **llm-auth** — provider credential resolution and upstream credential injection, with client/project/org scope selection
- **llm-metrics** — request counts, latency distributions, error rates, and bounded usage telemetry by provider, model, auth status, and tenant scope
- **llm-ratelimit** — per-user, per-key RPM/TPM rate limiting with shared-memory counters, in-flight reservation, and reconciliation from actual usage
- **llm-cost** — per-request cost calculation and cost event emission with configurable pricing tables per model. Enterprise adds the PostgreSQL backend and dashboard for turnkey aggregated reporting.
- **llm-cache** — conservative cache policy surface for deciding eligibility, scope, and bypass reasons before heavier replay or semantic-cache features are attempted
- **llm-security** — prompt-side inspection and policy enforcement for PII, secrets, and prompt injection patterns, with org/project policy layering
- **llm-fallback** — policy-driven provider failover for configured retryable failures, with translation-aware replay policy

Together, these modules let nginx act as a bounded AI control plane instead of a blind HTTP pipe: route the request, apply tenant-aware policy, account for what happened, and keep the data path inside your own infrastructure.

## Deployment scenarios

Ready-to-run gateway configurations for common deployment patterns — from a single-team OpenAI endpoint with per-model quotas to multi-provider failover with independent spend caps. Each scenario includes a plain-language use case, the provisioning manifest, and the rendered nginx.conf. See the [deployment scenarios overview](/docs/reference/token-modules/scenarios) for the full set.

To get started or discuss your team's requirements, [contact us](/contact).
