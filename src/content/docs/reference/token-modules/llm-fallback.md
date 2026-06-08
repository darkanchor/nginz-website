---
title: llm-fallback
description: Policy-driven provider failover for configured retryable failures, with ordered provider fallback graphs, streaming suppression, and translation-aware replay policy.
---

# llm-fallback

Use this module when the gateway must survive provider outages, transient 429s, or selectively retry transport failures without forcing every application to build its own provider-ordered retry tree.

## When to use this module

- You need ordered provider failover: when the primary provider fails, retry to a configured secondary.
- You want fine-grained control over which failure classes are retryable: `connect_error`, `transport_timeout`, `rate_limited`, `upstream_5xx`.
- You need to suppress fallback for streaming requests to avoid duplicating partial output to the client.
- You want pre-send provider replacement (not just post-failure fallback) via `llm_fallback_replace`.
- You need translation-aware replay policy: forbid or discourage fallback paths that would require cross-dialect translation.
- You want per-route model overrides so a fallback to a different provider can also switch models.
- You need observable fallback outcomes in response headers: `X-Fallback-Attempted`, `X-Fallback-Primary`, `X-Fallback-Effective`.

## nginx.conf synthesis

Basic ordered failover with retryable failure classes and streaming suppression.

```nginx
upstream openai_upstream   { server api.openai.com:443; }
upstream anthropic_upstream { server api.anthropic.com:443; }

location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_fallback;
    llm_fallback_mode basic;
    llm_fallback_route openai anthropic;
    llm_fallback_on connect_error transport_timeout upstream_5xx;
    llm_fallback_max_attempts 2;
    llm_fallback_allow_streaming off;

    # nginx must be configured to retry on matching failures
    proxy_next_upstream error timeout http_500 http_502 http_503;
    proxy_next_upstream_tries 2;

    proxy_pass https://$llm_provider_upstream;
}
```

Production configuration with pre-send replacement, model-override fallback, and translation-aware replay policy.

```nginx
upstream openai_upstream    { server api.openai.com:443; }
upstream anthropic_upstream  { server api.anthropic.com:443; }
upstream azure_upstream      { server azure-openai.example.com:443; }
upstream bedrock_upstream    { server bedrock-runtime.amazonaws.com:443; }

location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_route azure     azure_upstream  openai;    # explicit dialect
    llm_proxy_route bedrock   bedrock_upstream anthropic; # explicit dialect
    llm_proxy_default_provider openai;

    llm_fallback;
    llm_fallback_mode basic;

    # Pre-send replacement: openai → azure before first upstream send
    llm_fallback_replace openai azure;

    # Post-failure fallback: azure → anthropic, azure → bedrock with model override
    llm_fallback_route azure anthropic;
    llm_fallback_route azure bedrock claude-sonnet-4;

    llm_fallback_on connect_error transport_timeout upstream_5xx;
    llm_fallback_max_attempts 3;
    llm_fallback_allow_streaming off;

    # Translation-aware replay: forbid cross-dialect fallback
    llm_fallback_translation_fallback forbid;

    proxy_next_upstream error timeout http_500 http_502 http_503;
    proxy_next_upstream_tries 3;

    proxy_pass https://$llm_provider_upstream;
}
```

## Directive reference

### Core directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_fallback` | `location` | — | Enable fallback policy for this location. |
| `llm_fallback_mode` | `location` | unset | Enforcement mode. Currently only `basic` is accepted; `advanced` is rejected by the parser. |

### Route directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_fallback_route` | `location` | — | Ordered failover edge from `<primary>` to `<secondary>`. Optional third argument `<model>` overrides the effective model after failover. Repeatable, max 16 routes. Duplicate primaries and cyclic graphs are rejected at startup. |
| `llm_fallback_replace` | `location` | — | Pre-send replacement rule. When configured, `llm-proxy` replaces the primary provider with the replacement *before* the first upstream send — this is policy-driven substitution, not failure-driven retry. |

### Policy directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_fallback_on` | `location` | — | Retryable failure class bitmask. Accepts space-separated tokens: `connect_error`, `transport_timeout`, `rate_limited`, `upstream_5xx`. |
| `llm_fallback_max_attempts` | `location` | unset | Upper bound on total attempts, including the primary. When set, `llm-proxy` syncs nginx's effective `proxy_next_upstream_tries`. |
| `llm_fallback_allow_streaming` | `location` | `off` | Whether fallback is allowed for streaming requests. When `off`, streaming fallback is suppressed and `X-Fallback-Suppressed-Reason: streaming_not_allowed` is set. |
| `llm_fallback_translation_fallback` | `location` | `allow` | Cross-dialect replay policy. `allow`: cross-dialect retry permitted. `discourage`: marks the retry as `policy_mismatch` but does not suppress. `forbid`: marks the retry as `policy_mismatch` with `X-Fallback-Suppressed-Reason: translation_forbidden`. |

## Exported variables

| Variable | Description |
|---|---|
| `$llm_fallback_attempted` | `0`/`1` — whether fallback was attempted. |
| `$llm_fallback_suppressed` | `0`/`1` — whether fallback was suppressed. |
| `$llm_fallback_suppressed_reason` | Why fallback was suppressed (e.g., `streaming_not_allowed`, `translation_forbidden`). |
| `$llm_fallback_reason` | Failure class: `none`, `connect_error`, `transport_timeout`, `rate_limited`, `upstream_5xx`. |
| `$llm_fallback_attempt_count` | Number of upstream attempts, including the primary. |
| `$llm_fallback_policy_allowed` | `0`/`1` — whether the configured policy would allow the inferred first-hop failure reason. |
| `$llm_fallback_policy_mismatch` | `0`/`1` — whether nginx retried against the configured policy. |
| `$llm_fallback_primary_provider` | Provider selected before retry analysis. |
| `$llm_fallback_effective_provider` | Provider that actually served the final response. |

## Response headers

These headers are stamped by `llm-proxy` on responses from `llm_fallback`-enabled locations:

| Header | Description |
|---|---|
| `X-Fallback-Attempted` | `1` when retry occurred. |
| `X-Fallback-Suppressed` | `1` when retry was suppressed. |
| `X-Fallback-Attempt-Count` | Number of upstream attempts nginx recorded. |
| `X-Fallback-Primary` | First-hop provider name. |
| `X-Fallback-Effective` | Provider that served the final response. |
| `X-Fallback-Suppressed-Reason` | Why retry was suppressed. |
| `X-Fallback-Reason` | Failure classification string. |
| `X-Fallback-Policy-Allowed` | Whether the configured fallback policy allowed the inferred reason. |
| `X-Fallback-Policy-Mismatch` | `1` when nginx retried against policy. |

## Behavior notes

- `llm-fallback` is intentionally thin as a standalone runtime module. Fallback policy lives here; actual replay execution happens inside `llm-proxy` via nginx's `proxy_next_upstream` path.
- Pre-send replacement (`llm_fallback_replace`) fires in `llm-proxy`'s body handler before auth preparation, translation, and upstream send. It sets `$llm_resolution_outcome = replaced_by_policy` and `replacement_happened = 1`. It does NOT set `fallback_attempted`.
- Post-failure fallback is detected in `llm-proxy`'s header filter via `r->upstream_states.nelts > 1`.
- When a model override is configured on a fallback route, `effective_model` is updated to the override model after a successful retry.
- The `llm_fallback_translation_fallback forbid` value marks a cross-dialect retry as `policy_mismatch` after the fact, but cannot prevent nginx's `proxy_next_upstream` from firing. This is an architectural constraint of nginx's phase model.
- Replacement and fallback are distinct: `replacement_happened=1, fallback_attempted=0` for pre-send substitution; `fallback_attempted=1, replacement_happened=0` for failure-driven retry.
- Route graphs are validated at startup: duplicate primary providers and cyclic graphs are rejected.
- `llm_fallback_max_attempts` syncs nginx's effective `proxy_next_upstream_tries` before upstream execution.
- `llm_fallback_on` inheritance is replace-not-merge. Child locations must restate the full desired failure-class set when narrowing parent policy.
- Child locations with any local `llm_fallback_route` entries do not inherit parent routes. This is replace-not-merge semantics.
