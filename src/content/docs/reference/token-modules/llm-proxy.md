---
title: llm-proxy
description: Multi-provider LLM routing with explicit endpoint dialects, bidirectional OpenAI/Anthropic format translation, streaming normalization, and usage extraction including prompt-cache token buckets.
---

# llm-proxy

Use this module when nginx is the actual LLM edge for your platform. It resolves models to providers, translates request and response formats between dialects, normalizes streaming output, and extracts token usage — giving every downstream module one canonical source of truth.

## When to use this module

- You want a stable client surface while routing to multiple upstream providers behind the scenes.
- You need request body inspection to extract `model`, `stream`, and provider fields before upstream send.
- You must translate request bodies between OpenAI chat and Anthropic Messages formats transparently.
- You need streaming (SSE) response normalization back to the requested client dialect.
- You require token usage extracted from response bodies and surfaced as nginx variables for cost, rate limiting, and metrics modules, including prompt-cache read/create buckets for billing.
- You want provider rate-limit response headers (`x-ratelimit-reset-tokens`, `retry-after`) parsed and exposed as variables.
- You need a stable per-request context (`$llm_*` variables) consumed by every other llm-* module.

## nginx.conf synthesis

Route `/v1/chat/completions` to OpenAI and Anthropic upstreams, with full format normalization and streaming support.

```nginx
upstream openai_upstream   { server api.openai.com:443; }
upstream anthropic_upstream { server api.anthropic.com:443; }

location /v1/chat/completions {
    llm_proxy;

    # Routing: model prefix matches resolve to a provider
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;
    llm_proxy_max_body_size 64k;

    # Operator-managed model catalog (optional, replaces prefix heuristics)
    # llm_proxy_model_pattern gpt-4 openai;
    # llm_proxy_model_pattern claude anthropic;

    # Format: translate and normalize across dialects
    llm_proxy_normalize_response on;
    llm_proxy_inject_usage on;
    llm_proxy_provider_version anthropic 2023-06-01;
    llm_proxy_max_response_size 10m;

    # Dialect mode: how the gateway determines client request format
    # llm_proxy_dialect_mode infer;               # default: from body shape
    # llm_proxy_dialect_mode fixed;               # fixed by ingress_dialect
    # llm_proxy_ingress_dialect openai;           # required when dialect_mode fixed

    proxy_pass https://$llm_provider_upstream;
    proxy_ssl_server_name on;
    proxy_set_header Host $llm_provider_host;
    proxy_buffering off;  # required for streaming
}
```

Using a model catalog instead of prefix heuristics. Unknown models are rejected with 400 when patterns are configured.

```nginx
location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;

    # Operator-managed catalog — unknown models get 400, not default routing
    llm_proxy_model_pattern gpt-4o    openai;
    llm_proxy_model_pattern gpt-4     openai;
    llm_proxy_model_pattern gpt-3.5   openai;
    llm_proxy_model_pattern claude    anthropic;

    proxy_pass https://$llm_provider_upstream;
}
```

## Directive reference

### Routing directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_proxy` | `location` | — | Enable the module for this location. Inheritable through the location hierarchy. |
| `llm_proxy_route` | `location` | — | Map a provider name to an nginx upstream. Optional third argument declares the endpoint dialect (`openai` or `anthropic`; default `openai`). Provider and model names are never used to infer endpoint dialect. Repeatable, evaluated in definition order. Max 8 routes per location. |
| `llm_proxy_default_provider` | `location` | — | Provider used when the model prefix does not match any route, or when body extraction is skipped. Required if any `llm_proxy_route` is configured and no `llm_proxy_model_pattern` is set. |
| `llm_proxy_model_pattern` | `location` | — | Add an entry to the operator-managed model catalog. The `pattern` is matched as a case-insensitive prefix against the request `model` field. Repeatable, evaluated in definition order. Max 32 patterns. When any patterns are configured, unknown models are rejected with 400. |

### Request body directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_proxy_max_body_size` | `location` | `64k` | Maximum request-body bytes buffered for model extraction. Requests exceeding this size skip body extraction and use the default provider. Accepts `k`/`K`/`m`/`M` suffixes. |

### Format translation directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_proxy_normalize_response` | `location` | `on` | Enable cross-dialect body mediation. When requested and effective dialects differ, request bodies are translated into the endpoint dialect and responses are normalized back to the requested client dialect. When `off`, bodies pass through unmodified. |
| `llm_proxy_inject_usage` | `location` | `on` | Inject `stream_options: {"include_usage": true}` into OpenAI streaming requests so the final SSE chunk carries token counts. |
| `llm_proxy_provider_version` | `location` | — | Set the `$llm_provider_version` variable for the named provider. For `anthropic`, also sends `anthropic-version: <version>` upstream. Repeatable. |
| `llm_proxy_max_response_size` | `location` | `10m` | Maximum response-body bytes to buffer for normalization. Responses exceeding this limit are passed through unmodified. Accepts `k`/`K`/`m`/`M` suffixes. |
| `llm_proxy_disclose_provider` | `location` | `on` | Controls whether `X-LLM-Provider` is sent back to the client. Internal routing variables remain populated even when disclosure is off. |

### Dialect control directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_proxy_dialect_mode` | `location` | `infer` | Controls how the gateway determines the client request dialect. `infer`: inferred from body shape. `fixed`: set by `llm_proxy_ingress_dialect`. `explicit_required`: request must supply an explicit dialect or be rejected with 400. |
| `llm_proxy_ingress_dialect` | `location` | — | Dialect fixed at the ingress contract (`openai` or `anthropic`). Required when `llm_proxy_dialect_mode fixed`. |

## Exported variables

### Routing variables (set in ACCESS phase)

| Variable | Type | Description |
|---|---|---|
| `$llm_provider` | string | Resolved provider name (`openai`, `anthropic`, etc.). Empty on parse failure. |
| `$llm_provider_host` | string | Provider API hostname (`api.openai.com`, `api.anthropic.com`). Empty for unknown. |
| `$llm_provider_version` | string | API version string from `llm_proxy_provider_version`. Empty when unconfigured. |
| `$llm_model` | string | Raw model string from request body. Empty if absent or body not parsed. |
| `$llm_streaming` | `0`/`1` | Whether `"stream": true` was in the request body. |
| `$llm_provider_upstream` | string | nginx upstream name from `llm_proxy_route`. Empty if no match. |
| `$llm_body_parsed` | `0`/`1` | `1` only when the request body was valid JSON and model/stream were extracted. |

### Identity and resolution variables (Phase 12 — Milestone 2)

| Variable | Type | Description |
|---|---|---|
| `$llm_requested_provider` | string | Explicit provider from request body `"provider"` field. Empty when absent. |
| `$llm_requested_model` | string | Raw model from request body before resolution (same as `$llm_model`). |
| `$llm_requested_dialect` | string | Client-side dialect (`openai` or `anthropic`). From ingress contract or body-shape inference. |
| `$llm_requested_dialect_source` | string | How dialect was determined: `fixed_ingress`, `explicit`, or `inferred_shape`. |
| `$llm_effective_provider` | string | Resolved provider after catalog/policy evaluation (same as `$llm_provider`). |
| `$llm_effective_model` | string | Resolved model (same as `$llm_model` until model-replacement policy is applied). |
| `$llm_effective_dialect` | string | Dialect of the effective endpoint. From the route's explicit dialect argument, or `openai` when omitted. |
| `$llm_resolution_outcome` | string | One of `as_requested`, `replaced_by_policy`, `fallback_after_failure`, `rejected_out_of_scope`, `rejected_unresolvable`. |
| `$llm_translation_happened` | `0`/`1` | `1` when the request body was translated across dialects. |

### Token usage variables (set in response body filter)

| Variable | Type | Description |
|---|---|---|
| `$llm_prompt_tokens` | integer | Prompt token count from the usage block. Use in `log_format`, not `add_header`. |
| `$llm_completion_tokens` | integer | Completion token count from the usage block. Use in `log_format`, not `add_header`. |
| `$llm_total_tokens` | integer | Total token count from the usage block. Use in `log_format`, not `add_header`. |
| `$llm_cache_read_tokens` | integer | Prompt-cache tokens read/hit when the provider reports them. OpenAI reads from `usage.prompt_tokens_details.cached_tokens`; Anthropic reads from `usage.cache_read_input_tokens`. Use in `log_format`, not `add_header`. |
| `$llm_cache_create_tokens` | integer | Prompt-cache tokens written/created when the provider reports them. Anthropic reads from `usage.cache_creation_input_tokens`; providers that do not report creation tokens expose `0`. Use in `log_format`, not `add_header`. |
| `$llm_usage_extracted` | `0`/`1` | `1` once all three token counts are confirmed extracted. |

### Rate-limit header variables (set in response header filter)

| Variable | Type | Description |
|---|---|---|
| `$llm_reset_after_ms` | integer (ms) | Parsed from OpenAI `x-ratelimit-reset-tokens` or Anthropic `retry-after` (converted to ms). |
| `$llm_ratelimit_remaining_tokens` | integer | From `x-ratelimit-remaining-tokens` response header. |
| `$llm_ratelimit_remaining_requests` | integer | From `x-ratelimit-remaining-requests` response header. |

### Fallback observability variables (set in response header filter)

| Variable | Type | Description |
|---|---|---|
| `$llm_fallback_attempted` | `0`/`1` | `1` when nginx retried to a secondary upstream. |
| `$llm_fallback_suppressed` | `0`/`1` | `1` when retry was suppressed (e.g., for streaming requests). |
| `$llm_fallback_suppressed_reason` | string | Explicit caveat reason when replay is refused, such as `streaming_not_allowed`. |
| `$llm_fallback_reason` | string | One of `none`, `connect_error`, `transport_timeout`, `rate_limited`, `upstream_5xx`. |
| `$llm_fallback_attempt_count` | integer | Number of upstream attempts nginx recorded, including the primary. |
| `$llm_fallback_policy_allowed` | `0`/`1` | Whether the configured retry policy would allow the inferred first-hop failure reason. |
| `$llm_fallback_policy_mismatch` | `0`/`1` | `1` when nginx retried but the configured policy would not have allowed that reason. |
| `$llm_fallback_primary_provider` | string | Provider selected before retry analysis. |
| `$llm_fallback_effective_provider` | string | Provider that actually served the final response. |

## Response headers

`llm-proxy` stamps these response headers on every response from an enabled location:

| Header | Description |
|---|---|
| `X-LLM-Proxy: nginz-token` | Always present when the module is enabled. |
| `X-LLM-Provider: <provider>` | Provider name when known and `llm_proxy_disclose_provider on`. When disclosure is off, the module also strips any upstream-supplied `X-LLM-Provider` header. |
| `X-LLM-Reset-After-Ms` | Mirrors `$llm_reset_after_ms`. |
| `X-LLM-Remaining-Tokens` | Mirrors `$llm_ratelimit_remaining_tokens`. |
| `X-LLM-Remaining-Requests` | Mirrors `$llm_ratelimit_remaining_requests`. |
| `X-Fallback-Attempted` | `1` when nginx retried to another upstream. |
| `X-Fallback-Suppressed` | `1` when retry was suppressed. |
| `X-Fallback-Attempt-Count` | Number of upstream attempts nginx recorded. |
| `X-Fallback-Primary` | First-hop provider. |
| `X-Fallback-Effective` | Provider that served the final response after retry. |
| `X-Fallback-Reason` | Inferred failure reason for the first hop. |
| `X-Fallback-Policy-Allowed` | Whether the configured fallback policy allowed that reason. |
| `X-Fallback-Policy-Mismatch` | `1` when nginx retried against policy. |
| `X-Fallback-Suppressed-Reason` | Explicit suppression reason when present. |

## Behavior notes

- Request body is read in the ACCESS phase via `ngx_http_read_client_request_body`, which handles split TCP segments, chunked transfer, and `Expect: 100-continue`.
- Bodies exceeding `llm_proxy_max_body_size` route via the default provider without crashing or partial extraction.
- Non-JSON bodies (Content-Type not `application/json`) skip extraction and route to the default provider.
- Missing `model` field routes to the default provider and leaves `$llm_model` empty.
- `llm_proxy` locations explicitly reject nginx subrequests in `PREACCESS`.
- Provider auth header rewriting is driven by `llm-auth` policy but executed in `llm-proxy`'s body handler before upstream send.
- All usage token variables are set before the log phase fires, so `llm-cost` and `llm-ratelimit` reconciliation can read them in `log_format`.
- `$llm_prompt_tokens` is total input. OpenAI keeps the provider-reported `usage.prompt_tokens` total and exposes cache reads as a separate sub-bucket. Anthropic computes total input as `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
- Cache buckets are optional sub-buckets for pricing. Missing cache fields default to `0`; OpenAI `cached_tokens` greater than total prompt tokens is ignored.
- When fallback serves a response from a secondary provider, usage extraction follows the effective provider's wire format, not the originally requested provider.
- Cross-dialect body translation is bidirectional for OpenAI chat and Anthropic Messages dialects, but URI paths still need explicit nginx rewrite rules when client and upstream endpoints use different paths.
- For streaming responses, `usage_extracted` is set during the body filter pass — before the log phase fires.
- OpenAI-style 200 responses with an error body (`{"error": {...}}`) are detected and not normalized.
- Unknown JSON fields from providers are preserved in normalized output, not dropped.
- SSE streams that end without `[DONE]` close cleanly with `usage_extracted = 0`.
