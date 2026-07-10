---
title: llm-ratelimit
description: Per-identity RPM/TPM rate limiting with shared-memory counters, in-flight token reservation, reconciliation from actual usage, model-tier overrides, and provider-feedback cooldown.
---

# llm-ratelimit

Use this module when you offer shared LLM access to users, teams, or internal products and need plan limits, abuse protection, or spend containment enforced at the gateway itself rather than in every downstream app.

## When to use this module

- You need per-identity request-per-minute (RPM) quotas with burst allowance.
- You want token-per-minute (TPM) budgets that reserve estimated tokens pre-flight and reconcile against actual usage from `llm-proxy`.
- You need per-model or per-provider tier overrides for plan differentiation.
- You want stricter quotas on cross-dialect (translated) traffic via `llm_ratelimit_translated_rpm` and `llm_ratelimit_translated_tpm`.
- You need provider-feedback cooldown that uses `x-ratelimit-reset-tokens` headers to delay quota replenishment.
- You want the ability to roll out limits in dry-run mode first, observing deny decisions without actually rejecting traffic.
- You need composite quota keys (org, project, client) via the existing `llm_ratelimit_key` directive.
- You need gateway-local monthly spend budgets enforced without a database lookup on the proxy path.

## nginx.conf synthesis

Basic per-identity request and token quotas with burst.

```nginx
llm_ratelimit_zone rl_zone 10m;

location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_ratelimit;
    llm_ratelimit_key $http_x_api_key;
    llm_ratelimit_requests_per_minute 100;
    llm_ratelimit_burst_requests 20;
    llm_ratelimit_tokens_per_minute 50000;
    llm_ratelimit_reserve_tokens 4000;

    proxy_pass https://$llm_provider_upstream;
}
```

Production configuration with model-tier overrides, translated-traffic quotas, provider cooldown, and auth-fingerprint keying.

```nginx
llm_ratelimit_zone rl_zone 10m;

location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_auth;
    llm_auth_credential openai    env:OPENAI_KEY;
    llm_auth_tenant $http_x_tenant_id;
    llm_auth_fail_closed on;

    llm_ratelimit;
    llm_ratelimit_key $llm_auth_key_fingerprint;
    llm_ratelimit_requests_per_minute 500;
    llm_ratelimit_burst_requests 50;
    llm_ratelimit_tokens_per_minute 200000;
    llm_ratelimit_reserve_tokens 8000;
    llm_ratelimit_fail_open off;

    # Model-tier overrides: premium models get a tighter budget
    llm_ratelimit_model_rpm gpt-4o 50;
    llm_ratelimit_model_tpm gpt-4o 30000;
    llm_ratelimit_model_rpm claude-opus 30;
    llm_ratelimit_model_tpm claude-opus 20000;

    # Provider-tier override
    llm_ratelimit_provider_rpm anthropic 200;

    # Tighter limits on cross-dialect traffic
    llm_ratelimit_translated_rpm 50;
    llm_ratelimit_translated_tpm 40000;

    # Use effective model for tier overrides (default)
    llm_ratelimit_model_basis effective;

    # Monthly project spend budget in the provider's cost unit
    llm_ratelimit_spend_scope project usd $llm_auth_org $llm_auth_project 1200.00;
    # Reserve a conservative amount before admission; reconcile in LOG
    llm_ratelimit_reserve_spend usd 0.25;

    # Provider-feedback cooldown
    llm_ratelimit_cooldown on;

    proxy_pass https://$llm_provider_upstream;
}
```

## Directive reference

### Core directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_ratelimit` | `location` | — | Enable the module for this location. |
| `llm_ratelimit_zone` | `http` | `llm_ratelimit 1m` | Shared-memory ledger storage. Args: `<name> <size>`. Size accepts `k`/`K`/`m`/`M` suffixes. When unset, the module creates a default `llm_ratelimit` zone with the built-in default size. |
| `llm_ratelimit_key` | `location` | — | nginx variable used as the quota identity key. Derive from trusted gateway state such as `$llm_auth_key_fingerprint`, not raw client headers. |

### Request quota directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_ratelimit_requests_per_minute` | `location` | — | Per-minute request budget. Enforced in ACCESS phase. |
| `llm_ratelimit_burst_requests` | `location` | `0` | Additional request burst allowance beyond the base rate. |

### Token quota directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_ratelimit_tokens_per_minute` | `location` | — | Per-minute token budget. Reserved pre-flight and reconciled against actual `$llm_total_tokens` in LOG phase. |
| `llm_ratelimit_reserve_tokens` | `location` | `1000` | Estimated token reservation made pre-flight. Replaced by actual usage when available. Set close to realistic request cost for best containment. |

### Tier override directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_ratelimit_model_rpm` | `location` | — | Per-model RPM override. Args: `<model-prefix> <n>`. Repeatable. |
| `llm_ratelimit_model_tpm` | `location` | — | Per-model TPM override. Args: `<model-prefix> <n>`. Repeatable. |
| `llm_ratelimit_provider_rpm` | `location` | — | Per-provider RPM override. Args: `<provider> <n>`. Repeatable. |
| `llm_ratelimit_provider_tpm` | `location` | — | Per-provider TPM override. Args: `<provider> <n>`. Repeatable. |

### Translation-aware directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_ratelimit_translated_rpm` | `location` | — | Stricter RPM limit applied when request translation is detected (`$llm_translation_happened = 1`). |
| `llm_ratelimit_translated_tpm` | `location` | — | Stricter TPM limit applied when request translation is detected. |
| `llm_ratelimit_model_basis` | `location` | `effective` | Which model name to use for tier overrides: `requested` or `effective`. |
| `llm_ratelimit_provider_basis` | `location` | `effective` | Which provider name to use for tier overrides: `requested` or `effective`. |

### Policy directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_ratelimit_fail_open` | `location` | `off` | When `on`, missing identity or usage allows the request to proceed. When `off`, missing identity is denied. |
| `llm_ratelimit_dry_run` | `location` | `off` | When `on`, observe deny decisions and expose them via variables but never actually reject traffic. |
| `llm_ratelimit_cooldown` | `location` | `off` | When `on`, use provider `x-ratelimit-reset-tokens` / `retry-after` headers to delay quota replenishment. |

### Spend budget directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_ratelimit_spend_scope` | `location` | — | Monthly spend budget for one scope and cost unit. Args: `organization <unit> <org-var> <budget>`, `project <unit> <org-var> <project-var> <budget>`, or `client <unit> <org-var> <project-var> <client-var> <budget>`. The module checks only entries matching the effective provider's `llm_cost_rate_unit`. |
| `llm_ratelimit_reserve_spend` | `location` | — | Opt into hard ACCESS-phase spend admission. Args: `<unit> <amount>`. The amount is reserved against every configured scope using that unit, then reconciled to authoritative `llm-cost` usage in LOG. Omitted by default, preserving delayed/soft spend enforcement. Choose a conservative upper-bound estimate for one request. At most one reserve directive is allowed per location. |

## Exported variables

| Variable | Description |
|---|---|
| `$llm_ratelimit_deny_reason` | Why the request was denied: `request_budget_exhausted`, `token_budget_exhausted`, `spend_budget_exhausted`, `identity_missing`, or `config_invalid`. |
| `$llm_ratelimit_quota_remaining` | Remaining request quota for the current identity key. |
| `$llm_ratelimit_token_quota_remaining` | Remaining token quota for the current identity key. |
| `$llm_ratelimit_spend_deny_unit` | Cost unit for a spend-budget deny, such as `usd` or `credits`. |

## Behavior notes

- Request quotas are enforced in the ACCESS phase. Token quotas are reserved pre-flight and reconciled in the LOG phase.
- `llm_ratelimit` depends on `llm-proxy` having already populated the `$llm_*` request fields it consumes for overrides and reconciliation.
- All requests allowed in ACCESS phase consume one quota slot regardless of upstream outcome (2xx, 4xx, 5xx, or transport error). Requests denied by this module (429) do not consume an additional slot.
- Rejected-before-upstream requests (out-of-scope, unresolvable) have their consumed quota slot returned.
- Token reconciliation: actual `$llm_total_tokens` from `llm-proxy` replaces the pre-flight reservation. If usage is unavailable (`usage_extracted = 0`), the reservation stands as the documented fallback.
- Without `llm_ratelimit_reserve_spend`, spend budgets retain delayed/soft enforcement: authoritative cost is added in LOG, so the request that crosses the budget is allowed and the next matching request is denied.
- With `llm_ratelimit_reserve_spend`, ACCESS atomically reserves the configured amount before admission. Requests that cannot reserve within every matching scope are denied; LOG replaces the reservation with authoritative cost when available.
- A location accepts one reserve directive and therefore one reserved cost unit. Other configured units retain delayed/soft enforcement; use separate locations when multiple units each require hard reservation. Units are never converted, and scopes whose unit does not match the effective provider are not charged.
- Spend counters are isolated by scope, cost unit, and local calendar month. The module does not convert between units; `usd` and `credits` are separate counters.
- The shared-memory ledger is striped into 64 independently locked regions. ACCESS and LOG phase mutations touch only the owning stripe.
- Ledger entries are padded to 64 bytes (one cache line) to avoid false sharing.
- A full stop/start resets the shared-memory ledger. Hot reload preserves state only when the store layout matches.
- `llm_ratelimit_key` is operator-defined. If built from a client-controlled header, callers can evade quotas by rotating that header. Use `$llm_auth_key_fingerprint` or another server-trusted identity source.
- `llm_ratelimit_key` accepts a single nginx variable. Composite quota scoping (e.g., org + project) is achieved with nested `location` blocks — an outer location enforces the org ceiling and an inner location enforces the project sub-ceiling, each with its own `llm_ratelimit_key`.
- Dry-run mode (`llm_ratelimit_dry_run on`) exposes deny decisions via `$llm_ratelimit_deny_reason` but never returns 429.
