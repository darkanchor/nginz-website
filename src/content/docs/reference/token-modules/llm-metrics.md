---
title: llm-metrics
description: Provider-level request counts, latency distributions, error rates, and usage telemetry by provider, model, auth status, and tenant scope. Exports Prometheus text format.
---

# llm-metrics

Use this module when you need provider-level visibility into LLM traffic flowing through the gateway. It consumes normalized facts from `llm-proxy` and exposes per-provider, per-model, and per-tenant counters — without reparsing request or response bodies.

## When to use this module

- You need to answer operational questions: which provider is carrying the load, which models are slow, and what error rate is provider-specific versus gateway-specific.
- You want Prometheus-compatible metrics exported directly from nginx without a sidecar or log scraper.
- You need to measure how often usage data is missing (making cost data incomplete).
- You want latency histograms broken down by provider.
- You need per-tenant aggregation for chargeback or capacity planning.
- You want to track translation and replacement rates across native and cross-dialect traffic.
- You need auth-resolution health metrics (how often credential resolution fails).

## nginx.conf synthesis

Basic metrics export with provider and model labels.

```nginx
llm_metrics_zone metrics_zone 10m;

server {
    listen 18080;

    location /metrics {
        llm_metrics;
        llm_metrics_export prometheus;
    }

    location /v1 {
        llm_proxy;
        llm_proxy_route openai    openai_upstream;
        llm_proxy_route anthropic anthropic_upstream anthropic;
        llm_proxy_default_provider openai;

        llm_metrics;
        llm_metrics_label_model on;
        llm_metrics_emit_usage on;

        proxy_pass https://$llm_provider_upstream;
    }
}
```

Full production configuration with auth-status labels, tenant aggregation, and resolution-outcome tracking.

```nginx
llm_metrics_zone metrics_zone 10m;

server {
    listen 18080;

    location /metrics {
        llm_metrics;
        llm_metrics_export prometheus;
    }

    location /v1 {
        llm_proxy;
        llm_proxy_route openai    openai_upstream;
        llm_proxy_route anthropic anthropic_upstream anthropic;
        llm_proxy_default_provider openai;

        llm_auth;
        llm_auth_credential openai    env:OPENAI_KEY;
        llm_auth_credential anthropic env:ANTHROPIC_KEY;
        llm_auth_tenant $http_x_tenant_id;
        llm_auth_fail_closed on;

        llm_metrics;
        llm_metrics_label_model on;
        llm_metrics_label_auth_status on;
        llm_metrics_label_resolution_outcome on;
        llm_metrics_label_tenant on;
        llm_metrics_tenant_source $http_x_tenant_id;
        llm_metrics_emit_usage on;

        proxy_pass https://$llm_provider_upstream;
    }
}
```

## Directive reference

### Core directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_metrics` | `location` | — | Enable the module for this location. |
| `llm_metrics_zone` | `http` | `llm_metrics 10m` | Shared-memory backing for counters and histograms. Args: `<name> <size>`. Size accepts `k`/`K`/`m`/`M` suffixes. When unset, the module creates a default `llm_metrics` zone with the built-in default size. |
| `llm_metrics_export` | `location` | — | Select export mode. Currently only `prometheus` is supported. The content handler is registered on the configured location. Export is safe under subrequests: `HEAD` requests suppress body, subrequests return 403. |

### Label directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_metrics_label_model` | `location` | `off` | Emit bounded model-labeled counter families. Uses a fixed-capacity shared-memory table; unknown or oversized model keys go to the `_overflow` bucket. |
| `llm_metrics_label_auth_status` | `location` | `off` | Emit bounded auth-status counter families when `llm-auth` status is available. |
| `llm_metrics_label_resolution_outcome` | `location` | `off` | Emit resolution-outcome counter family with 6 fixed buckets: `as_requested`, `replaced_by_policy`, `fallback_after_failure`, `rejected_out_of_scope`, `rejected_unresolvable`, `other`. |
| `llm_metrics_label_tenant` | `location` | `off` | Emit bounded per-tenant request and error counters. Uses a fixed-capacity 32-entry table with `_overflow` bucket. |
| `llm_metrics_tenant_source` | `location` | — | nginx variable that provides the tenant identity string. Required when `llm_metrics_label_tenant on`. |
| `llm_metrics_emit_usage` | `location` | `off` | Emit token counters (`prompt_tokens`, `completion_tokens`, `total_tokens`) only when usage was successfully extracted. |

## Exported metrics

### Base counters (always emitted)

| Metric | Labels | Description |
|---|---|---|
| `llm_requests_total` | `provider`, `streaming` | Total requests by provider and streaming mode. |
| `llm_requests_parse_fallback_total` | — | Requests that could not be parsed and fell back to default routing. |
| `llm_requests_error_provider_total` | `provider` | Semantic provider errors (4xx). |
| `llm_requests_error_gateway_total` | — | Gateway-level errors. |
| `llm_requests_usage_missing_total` | `provider` | Responses where usage was not extracted. |
| `llm_requests_translation_total` | `provider` | Requests translated across dialects. |
| `llm_requests_replacement_total` | `provider` | Requests where the provider was replaced by policy. |

### Latency histogram

| Metric | Labels | Description |
|---|---|---|
| `llm_request_duration_seconds` | `provider` | 5-bucket histogram: `<100ms`, `<500ms`, `<2s`, `<10s`, `≥10s`. |

### Token counters (when `llm_metrics_emit_usage on`)

| Metric | Labels | Description |
|---|---|---|
| `llm_prompt_tokens_total` | `provider` | Total prompt tokens consumed. |
| `llm_completion_tokens_total` | `provider` | Total completion tokens consumed. |

### Opt-in label families

| Metric | Labels | Description |
|---|---|---|
| `llm_requests_model_total` | `provider`, `model` | Requests by provider and model. Requires `llm_metrics_label_model on`. |
| `llm_requests_error_model_total` | `provider`, `model` | Errors by provider and model. Requires `llm_metrics_label_model on`. |
| `llm_requests_auth_status_total` | `provider`, `auth_status` | Requests by provider and auth resolution status. Requires `llm_metrics_label_auth_status on`. |
| `llm_requests_error_auth_status_total` | `provider`, `auth_status` | Errors by provider and auth status. Requires `llm_metrics_label_auth_status on`. |
| `llm_requests_resolution_outcome_total` | `outcome` | Requests by resolution outcome. Requires `llm_metrics_label_resolution_outcome on`. |
| `llm_requests_tenant_total` | `tenant` | Requests by tenant. Requires `llm_metrics_label_tenant on`. |
| `llm_requests_error_provider_tenant_total` | `tenant` | Provider errors by tenant. Requires `llm_metrics_label_tenant on`. |
| `llm_requests_error_gateway_tenant_total` | `tenant` | Gateway errors by tenant. Requires `llm_metrics_label_tenant on`. |

## Behavior notes

- All counter increments happen in the LOG phase after the response is complete.
- Provider labels are bounded to `openai`, `anthropic`, `other`, and `total`.
- Model labels are lowercased and use a fixed-capacity table. Oversized keys (>63 chars) and table-overflow keys go to `_overflow`.
- Tenant labels use a 32-entry fixed-capacity table. Oversized keys (>63 chars) go to `_overflow`.
- Per-worker counter ownership means provider/auth/outcome increments are lock-free. Only model/tenant table inserts take the slab mutex and only on first encounter of a new label value.
- Hot reload preserves counters only when the existing `LlmMetricsStore` layout matches the new binary.
- The export handler detects buffer overflow: if the Prometheus text output exceeds the export buffer, it returns 503 rather than silently truncating.
- Metric cardinality is bounded by configuration. Enable opt-in labels only when needed.
