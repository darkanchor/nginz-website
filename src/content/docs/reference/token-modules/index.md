---
title: nginz-token
description: AI gateway modules for stock nginx — source-available under BSL 1.1, with token-level rate limiting, per-user cost tracking, semantic caching, and prompt security. Coming soon.
---

# nginz-token

nginz-token is in active development. This section will document the full module catalog once the first release ships.

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
- **llm-cache** — semantic response caching via embedding similarity
- **llm-security** — prompt injection detection and PII filtering at the gateway
- **llm-fallback** — provider failover and load-aware, cost-aware, latency-aware model switching
- **Dashboard** — web UI for cost trends, usage by team, quota status

For early access or to discuss your team's requirements, [contact us](/contact).
