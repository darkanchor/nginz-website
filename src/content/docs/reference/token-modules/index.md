---
title: nginz-token
description: AI gateway modules for stock nginx — source-available under BSL 1.1, with token-level rate limiting, per-user cost tracking, bounded cache policy, and prompt security. Coming soon.
---

# nginz-token

nginz-token is in active development. This section will document the full module catalog once the first release ships.

Cache is intentionally described conservatively here. `llm-cache` is a real module boundary and product concern, but the current direction is around cache eligibility, isolation, and bypass observability first. Semantic similarity lookup and general response replay are not the promise we are making for the initial release.

## License

nginz-token is **source-available under BSL 1.1**.

- You can read the code.
- You can evaluate it locally.
- You can use it for personal and non-commercial work.
- Commercial production use requires a license.

`nginz` and `nginz-njs` remain Apache 2.0. nginz-token is the commercial AI gateway layer.

## What's coming

All nginz-token modules ship under BSL 1.1:

- **llm-proxy** — multi-provider routing with transparent request/response format rewriting and per-request variable exposure for downstream modules
- **llm-auth** — API key validation and provider credential injection
- **llm-metrics** — request counts, latency distributions, error rates, and usage telemetry by model and identity
- **llm-ratelimit** — per-user, per-key RPM/TPM rate limiting with shared-memory counters
- **llm-cost** — per-request cost calculation and asynchronous PostgreSQL logging
- **llm-cache** — conservative cache policy surface for deciding eligibility, scope, and bypass reasons before heavier replay or semantic-cache features are attempted
- **llm-security** — prompt injection detection and PII filtering at the gateway
- **llm-fallback** — provider failover and load-aware, cost-aware, latency-aware model switching

For early access or to discuss your team's requirements, [contact us](/contact).
