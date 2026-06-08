---
title: Deployment Scenarios
description: Supported deployment scenarios for nginz-token with plain-language use cases, YAML/JSON manifests, and rendered gateway config.
---

# Deployment Scenarios

These pages are supported deployment scenarios you can start from when bringing up the product.

Use them when you need:

1. a known-good starting manifest
2. a deployment pattern that maps directly to rendered gateway config
3. a concrete example to compare against when your own manifest fails

## Supported Scenarios

- **[Cost-Control](/docs/reference/token-modules/scenarios/cost-control)** — one provider, one project, one gateway credential, and per-model quota enforcement for a small team.
- **[Policy-Governor](/docs/reference/token-modules/scenarios/policy-governor)** — Anthropic and OpenAI behind one organization, with two projects that have different native-model allowlists and quotas.
- **[Meter-Fallback](/docs/reference/token-modules/scenarios/meter-fallback)** — DeepSeek as the primary provider (USD) with Mimo as the automatic fallback (Credit), separate monthly spend caps per cost unit, and no per-model rate limits.
- **[Translation-Pass](/docs/reference/token-modules/scenarios/translation-pass)** — one Anthropic provider serving both Anthropic SDK and OpenAI SDK clients behind the same hostname; native pass-through on `/v1/messages`, OpenAI-to-Anthropic translation with response normalization on `/v1/chat/completions`.

Each scenario includes:

- the plain-language use case
- the manifest in YAML and JSON tabs
- the rendered `nginx.conf` shape produced from that manifest

These scenarios are intentionally minimal — each one isolates a single deployment pattern to keep the manifest readable. Real deployments commonly combine patterns: multiple projects with different policy envelopes, fallback wiring alongside translation, spend caps layered on top of per-model limits, or additional providers alongside native pass-through routes. Use these as starting points and adapt or merge them to fit your organization's shape.
