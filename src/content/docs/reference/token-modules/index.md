---
title: nginz-token Module Reference
description: AI gateway modules for stock nginx — token-level rate limiting, per-user cost tracking, semantic caching, and prompt security. Coming soon.
---

# nginz-token Module Reference

nginz-token is in active development. This section will document the full module catalog once the first release ships.

## What's coming

The open source platform layer (Apache 2.0):

- **llm-proxy** — multi-provider routing with transparent request/response format rewriting and per-request variable exposure for downstream modules
- **llm-auth** — API key validation and provider credential injection
- **llm-fallback** — simple circuit-breaker failover between providers

`llm-proxy` remains data-plane only. Aggregation, export, persistence, and management surfaces live in paid modules.

The paid management layer (BSL 1.1):

- **llm-metrics** — request counts, latency distributions, error rates, and usage telemetry by model and identity
- **llm-ratelimit** — per-user, per-key RPM/TPM rate limiting with shared-memory counters
- **llm-cost** — per-request cost calculation and asynchronous PostgreSQL logging
- **llm-cache** — semantic response caching via embedding similarity
- **llm-security** — prompt injection detection and PII filtering at the gateway
- **llm-fallback (advanced)** — load-aware, cost-aware, latency-aware model switching
- **Dashboard** — web UI for cost trends, usage by team, quota status

For early access or to discuss your team's requirements, [contact us](/contact).
