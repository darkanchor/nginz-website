---
title: llm-cost
description: Per-request cost calculation with configurable rate cards, cached-input pricing, and PostgreSQL-backed cost event logging with full attribution for chargeback and billing.
---

# llm-cost

Use this module when the gateway is becoming a shared internal platform or customer-facing product and you need trustworthy usage accounting for budgets, chargeback, billing, or finance reporting.

## When to use this module

- You need to compute per-request cost from prompt and completion token counts using configurable rate cards.
- You need cached-input pricing for providers that discount prompt-cache reads or price cache creation separately.
- You want cost events persisted to PostgreSQL for dashboarding, billing rollups, and audit trails.
- You need full attribution (org, project, client, user, team, auth key fingerprint) in each cost record.
- You need to distinguish accounting states: `recorded`, `skipped_error`, `usage_missing`, `no_rate`, and `persist_failed`.
- You want translation-aware billing: records include `translation_happened` and auto-stamp `translated` traffic cohort.
- You need requested-vs-effective routing attribution in cost records for policy auditability.
- You want rate-card versioning so pricing changes are auditable over time.

## nginx.conf synthesis

Basic cost accounting with log-level output for development.

```nginx
# Rates are USD per million tokens: prompt/input first, completion/output second.
llm_cost_rate openai gpt-4o 5.00 15.00;
llm_cost_rate anthropic claude 3.00 15.00;
llm_cost_rate_unit anthropic usd;

location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_cost;
    llm_cost_backend log;

    access_log /var/log/nginx/llm-cost.log combined;

    proxy_pass https://$llm_provider_upstream;
}
```

Production configuration with PostgreSQL persistence, full attribution, and rate-card versioning.

```nginx
# Standard input/output rates are per million tokens.
llm_cost_rate openai gpt-4o        5.00  15.00;
llm_cost_rate openai gpt-4         30.00 60.00;
llm_cost_rate openai gpt-3.5-turbo 0.50  1.50;
llm_cost_rate anthropic claude     3.00  15.00;

# Cached-input rates are also per million tokens.
# OpenAI reports cache reads; cache creation is not configured and falls back to prompt rate.
llm_cost_cached_rate openai gpt-4o 2.50;

# Anthropic reports cache reads and cache creation/write tokens.
llm_cost_cached_rate anthropic claude 0.30 3.75;

llm_cost_rate_unit openai    usd;
llm_cost_rate_unit anthropic usd;
llm_cost_backend postgres;
llm_cost_dsn "host=127.0.0.1 port=5432 dbname=darkanchor user=llm_cost password=changeme";
llm_cost_table public.llm_cost_events;
llm_cost_rate_card_version 2026-q2;

location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_auth;
    llm_auth_credential openai    env:OPENAI_KEY;
    llm_auth_tenant $http_x_tenant_id;
    llm_auth_project $http_x_project_id;
    llm_auth_org $http_x_org_id;
    llm_auth_fail_closed on;

    llm_cost;
    llm_cost_identity $llm_auth_key_fingerprint;
    llm_cost_org $llm_auth_org;
    llm_cost_project $llm_auth_project;
    llm_cost_client $llm_auth_client;
    llm_cost_user $http_x_user_id;
    llm_cost_team $http_x_team_id;
    llm_cost_auth_fingerprint $llm_auth_key_fingerprint;
    llm_cost_traffic_cohort $http_x_traffic_cohort;

    proxy_pass https://$llm_provider_upstream;
}
```

## Directive reference

### Core directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_cost` | `location` | — | Enable cost accounting for this location. |
| `llm_cost_backend` | `http`, `server` | `log` | Persistence backend: `off`, `log`, or `postgres`. |

### Rate-card directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_cost_rate` | `http`, `server` | — | Add a standard rate-card entry. Args: `<provider> <model-prefix> <prompt-rate-per-million> <completion-rate-per-million>`. The model prefix is matched against the effective model. Up to 32 entries. Rates must be finite and non-negative. |
| `llm_cost_cached_rate` | `http`, `server` | — | Add an optional cached-input rate-card entry. Args: `<provider> <model-prefix> <cache-read-rate-per-million> [<cache-create-rate-per-million>]`. When omitted, cached tokens are billed at the normal prompt rate. When only the read rate is supplied, cache-create tokens fall back to the normal prompt rate. Up to 32 entries. Rates must be finite and non-negative. |
| `llm_cost_rate_unit` | `http`, `server` | `usd` | Bind a provider to a pricing unit such as `usd`, `cny`, or `credits`. |
| `llm_cost_rate_card_version` | `http`, `server` | — | Version label stamped into every persisted accounting row. Use this to audit when pricing changes took effect. |

### PostgreSQL directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_cost_dsn` | `http`, `server` | — | PostgreSQL connection string. Required when `llm_cost_backend postgres`. |
| `llm_cost_table` | `http`, `server` | `llm_cost_events` | Target table for INSERT. When unset, the module writes to `llm_cost_events`. |

### Attribution directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_cost_identity` | `location`, `server` | — | nginx variable for the primary identity/tenant attribution. |
| `llm_cost_org` | `location`, `server` | — | nginx variable for org attribution. |
| `llm_cost_project` | `location`, `server` | — | nginx variable for project attribution. |
| `llm_cost_client` | `location`, `server` | — | nginx variable for client attribution. |
| `llm_cost_user` | `location`, `server` | — | nginx variable for user attribution. |
| `llm_cost_team` | `location`, `server` | — | nginx variable for team attribution. |
| `llm_cost_auth_fingerprint` | `location`, `server` | — | nginx variable carrying a non-secret auth key fingerprint. |
| `llm_cost_traffic_cohort` | `location`, `server` | — | Optional cohort label for rollout or canary attribution. Falls back to `translated` when translation happened and no explicit cohort is set, otherwise `fallback` when llm-fallback retried, otherwise `default`. |

## Exported variables

| Variable | Description |
|---|---|
| `$llm_cost_status` | Accounting status: `recorded`, `skipped_error`, `usage_missing`, `no_rate`, or `persist_failed`. |
| `$llm_cost_prompt` | Computed prompt cost in the configured unit. |
| `$llm_cost_completion` | Computed completion cost in the configured unit. |
| `$llm_cost_total` | Computed total cost in the configured unit. |
| `$llm_cost_requested_provider` | Provider the client requested (before any policy replacement). |
| `$llm_cost_requested_model` | Model the client requested. |
| `$llm_cost_translation_happened` | `0`/`1` — whether the request was translated across dialects. |
| `$llm_cost_resolution_outcome` | How the request was resolved: `as_requested`, `replaced_by_policy`, etc. |
| `$llm_cost_org` | Org attribution from `llm_cost_org`. |
| `$llm_cost_project` | Project attribution. |
| `$llm_cost_client` | Client attribution. |

## Persisted PostgreSQL columns

When `llm_cost_backend postgres` is enabled, each request produces one INSERT with these fields:

| Column | Description |
|---|---|
| `event_id` | nginx request ID; uniquely indexed for idempotent retries. |
| `provider` | Effective provider that served the request. |
| `model` | Effective model. |
| `cost_unit` | Pricing unit for this provider. |
| `traffic_cohort` | Cohort label for traffic splitting. |
| `is_streaming` | Whether the request was streaming. |
| `prompt_tokens` | Total prompt/input token count. For Anthropic this includes `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; for OpenAI this is the provider-reported total prompt token count. |
| `completion_tokens` | Completion token count. |
| `total_tokens` | Total token count. |
| `prompt_cost` | Computed prompt/input cost. When cached-token rates match, this is the blended cost of regular input, cache reads, and cache creation. |
| `completion_cost` | Computed completion cost. |
| `total_cost` | Computed total cost. |
| `status` | Accounting status string. |
| `status_code` | HTTP status code returned to the client. |
| `duration_ms` | Request duration in milliseconds. |
| `identity` | Primary identity from `llm_cost_identity`. |
| `user_id` | User attribution. |
| `team_id` | Team attribution. |
| `auth_key_fingerprint` | Non-secret auth key fingerprint. |
| `rate_card_version` | Rate-card version at the time of the request. |
| `requested_provider` | Provider the client requested. |
| `requested_model` | Model the client requested. |
| `translation_happened` | Whether format translation occurred. |
| `resolution_outcome` | How the routing was resolved. |
| `org` | Org attribution. |
| `project` | Project attribution. |
| `client` | Client attribution. |

## Behavior notes

- Cost is computed in the LOG phase after the response is complete. Usage authority comes only from `llm-proxy`'s extracted token counts.
- Rate-card model matching uses prefix matching: a `gpt-4o` entry matches `gpt-4o-mini` unless a more specific entry exists.
- All standard input, cached input, and output rates are per million tokens. The module does not support per-kilo pricing units.
- Without a matching `llm_cost_cached_rate`, cost is calculated as: `(prompt_tokens / 1,000,000) * prompt_rate + (completion_tokens / 1,000,000) * completion_rate`.
- With a matching `llm_cost_cached_rate`, prompt cost is blended as: `(regular_input_tokens / 1,000,000) * prompt_rate + (cache_read_tokens / 1,000,000) * cache_read_rate + (cache_create_tokens / 1,000,000) * cache_create_or_prompt_rate`.
- `regular_input_tokens` is defensively clamped from `prompt_tokens - cache_read_tokens - cache_create_tokens`; malformed cache splits cannot make regular input negative.
- Cached-token splits are internal pricing buckets from `llm-proxy`. They are not stored as extra PostgreSQL columns; persisted `prompt_tokens` remains total input and `prompt_cost` carries the blended result.
- `$llm_cost_status = no_rate` rows are persisted to PostgreSQL with zero-cost columns so unpriced traffic is auditable.
- PostgreSQL writes are asynchronous: LOG copies into a fixed 512-record FIFO per worker, and one worker-owned non-blocking connection drains it in order.
- A full queue never blocks or overwrites. The affected request reports `persist_failed` and emits a recovery record; later SQL failures emit a recovery record while the already-written request log remains `recorded`.
- The in-memory queue does not survive SIGKILL. Use the structured accounting log as a durable replay source when zero loss is required.
- Drain capacity depends on PostgreSQL commit latency. Capacity-plan from a measured drain rate and alert on queue-full/drain recovery logs; direct queue-depth export remains a telemetry follow-up.
- PostgreSQL persistence uses parameterized `PQsendQueryParams` and `ON CONFLICT (event_id) DO NOTHING` for injection safety and idempotent retries.
- Cost is computed against `effective_provider` / `effective_model`, so fallback traffic is priced correctly against the provider that actually served the response.
- Only one final usage record is emitted. If the first hop fails and nginx retries to a secondary, the first-hop partial spend is not recorded as a separate event.
