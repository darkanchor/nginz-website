---
title: Meter-Fallback
description: DeepSeek as the primary provider (USD) with Mimo as the automatic fallback (Credit), separate monthly spend caps per cost unit, and no per-model rate limits.
---

# Meter-Fallback

## Use Case

This scenario is for a platform team that has active accounts with both DeepSeek (USD-billed) and Mimo (Credit-billed) and wants DeepSeek to serve all traffic under normal conditions, with Mimo as the automatic fallback when DeepSeek is unavailable or rate-limited.

One org, one project, one gateway credential. Clients send OpenAI-compatible requests to a single endpoint. The gateway resolves the model to the primary provider (DeepSeek). If that attempt fails on a retryable failure class, the gateway retries to Mimo using nginx's `proxy_next_upstream` path. Because both providers expose OpenAI-compatible endpoints, no dialect translation is needed on the fallback path.

The four allowed models:

| Provider | Model | Input / 1M tokens | Cached input / 1M tokens | Output / 1M tokens | Unit |
|---|---:|---:|---:|---:|---:|
| DeepSeek | `deepseek-v4-pro` | 0.435 | 0.003625 | 0.87 | USD |
| DeepSeek | `deepseek-v4-flash` | 0.14 | 0.0028 | 0.28 | USD |
| Mimo | `mimo-v2.5-pro` | 300 | 2.5 | 600 | Credit |
| Mimo | `mimo-v2.5` | 100 | 2.0 | 200 | Credit |

Rates are sourced from provider pricing pages as of 2026-06-08.

All three quotas are project-level constraints on the AI Platform project: two monthly spend caps (one per cost unit) and a single rate-limit policy covering both DeepSeek models.

| Cost unit | Monthly cap |
|---|---:|
| USD | 800 |
| Credit | 100,000 |

| Model | RPM | TPM |
|---|---:|---:|
| `deepseek-v4-pro` | 300 | 250,000 |
| `deepseek-v4-flash` | 300 | 250,000 |

Fallback fires on any of: `connect_error`, `transport_timeout`, `upstream_5xx`, `rate_limited`. Streaming requests are excluded from fallback to prevent partial output from being duplicated to the client.

DeepSeek and Mimo use different model name catalogs. The `llm_fallback_route` directive accepts an optional third argument that replaces the model name on the fallback path. This scenario uses `llm_fallback_route deepseek mimo mimo-v2.5-pro`, which substitutes `mimo-v2.5-pro` when retrying to Mimo regardless of which DeepSeek model the client originally requested. Without this override, Mimo would receive an unknown DeepSeek model name and return a 400.

After applying this scenario and issuing credentials, internal clients should call the gateway at:

| Project | Gateway URL | Credential to issue | Header |
|---|---|---|---|
| AI Platform | `http://ai-platform.gateway.internal/v1/chat/completions` | `da-sk-acme-ai-platform.<issued-secret>` | `Authorization: Bearer da-sk-acme-ai-platform.<issued-secret>` |

The prefix before the dot is the `key_id` from the manifest. The secret suffix is printed once by `packaging/provision/issue.ts --display-once`; it is not stored in the manifest and should not be checked into source control.
## Manifest

<div class="doc-tabs">
<div class="doc-tab-list">
  <button class="doc-tab-button active" data-tab="0">YAML</button>
  <button class="doc-tab-button" data-tab="1">JSON</button>
</div>
<div class="doc-tab-panel active" data-tab="0">

```yaml
customer:
  serial: "replace-with-customer-serial"
  company: "Acme AI Labs"
  contact: "platform@acme.example"
  product: enterprise

deployment:
  environment_id: acme-prod
  environment_name: "Acme Production"
  deployment_id: "acme-prod-meter-fallback-001"
  product_version: "1.0.6"
  enabled_features:
    - name: llm-auth
      enabled: true
      notes: gateway credentials are separated from provider upstream keys
    - name: llm-proxy
      enabled: true
      notes: DeepSeek primary with Mimo fallback, both OpenAI-compatible endpoints
    - name: llm-fallback
      enabled: true
      notes: retry to mimo on deepseek connect/timeout/5xx/429 failures; streaming excluded
    - name: llm-cost
      enabled: true
      notes: per-request cost tracking; deepseek billed in usd, mimo billed in credit
      config:
        rate_card_version: provider-standard-2026-06-08
        rate_units:
          - { provider: deepseek, unit: usd    }
          - { provider: mimo,     unit: credit }
        rates:
          - { provider: deepseek, model: deepseek-v4-pro,   input: 0.435, output: 0.87  }
          - { provider: deepseek, model: deepseek-v4-flash, input: 0.14,  output: 0.28  }
          - { provider: mimo,     model: mimo-v2.5-pro,     input: 300,   output: 600   }
          - { provider: mimo,     model: mimo-v2.5,         input: 100,   output: 200   }
        cached_rates:
          - { provider: deepseek, model: deepseek-v4-pro,   cache_read: 0.003625 }
          - { provider: deepseek, model: deepseek-v4-flash, cache_read: 0.0028   }
          - { provider: mimo,     model: mimo-v2.5-pro,     cache_read: 2.5      }
          - { provider: mimo,     model: mimo-v2.5,         cache_read: 2.0      }
  configured_providers:
    - deepseek
    - mimo
  gateway:
    upstreams:
      - name: deepseek_server
        server: api.deepseek.com:443
        ssl_name: api.deepseek.com
        keepalive: 32
      - name: mimo_server
        server: token-plan-cn.xiaomimimo.com:443
        ssl_name: token-plan-cn.xiaomimimo.com
        keepalive: 32
    credentials:
      - provider: deepseek
        api_key: env:DEEPSEEK_API_KEY
      - provider: mimo
        api_key: env:MIMO_API_KEY
    routes:
      - location: /v1/chat/completions
        provider: deepseek
        dialect: openai
        upstream: deepseek_server
        auth_fail_closed: true
        secondary_providers:
          - provider: mimo
            upstream: mimo_server
        fallback:
          mode: basic
          route: [deepseek, mimo, mimo-v2.5-pro]
          on: [connect_error, transport_timeout, upstream_5xx, rate_limited]
          max_attempts: 2
          allow_streaming: false

organizations:
  - organization_id: "30000000-0000-0000-0000-000000000001"
    organization_slug: acme
    organization_name: "Acme AI Labs"
    environment_id: acme-prod
    status: active
    runtime: {}
    quotas:
      - scope_type: project
        project_id: "30000000-0000-0000-0001-000000000001"
        monthly_spend_limit: 800
        monthly_spend_unit: usd
        enforcement_mode: enforce
        notes: deepseek monthly spend hard cap
      - scope_type: project
        project_id: "30000000-0000-0000-0001-000000000001"
        monthly_spend_limit: 100000
        monthly_spend_unit: credit
        enforcement_mode: enforce
        notes: mimo monthly credit hard cap
      - scope_type: project
        project_id: "30000000-0000-0000-0001-000000000001"
        rpm_limit: 300
        tpm_limit: 250000
        enforcement_mode: enforce
        model_allowlist:
          - deepseek-v4-pro
          - deepseek-v4-flash
        notes: rate limit for deepseek models
    projects:
      - project_id: "30000000-0000-0000-0001-000000000001"
        project_slug: ai-platform
        project_name: "AI Platform"
        status: active
        clients:
          - client_id: "30000000-0000-0001-0001-000000000001"
            client_name: "AI Platform Gateway Key"
            client_type: gateway_key
            status: active
            api_keys:
              - key_id: da-sk-acme-ai-platform
                tier: basic
                status: active
```
</div>
<div class="doc-tab-panel" data-tab="1">

```json
{
  "customer": {
    "serial": "replace-with-customer-serial",
    "company": "Acme AI Labs",
    "contact": "platform@acme.example",
    "product": "enterprise"
  },
  "deployment": {
    "environment_id": "acme-prod",
    "environment_name": "Acme Production",
    "deployment_id": "acme-prod-meter-fallback-001",
    "product_version": "1.0.6",
    "enabled_features": [
      { "name": "llm-auth", "enabled": true, "notes": "gateway credentials are separated from provider upstream keys" },
      { "name": "llm-proxy", "enabled": true, "notes": "DeepSeek primary with Mimo fallback, both OpenAI-compatible endpoints" },
      { "name": "llm-fallback", "enabled": true, "notes": "retry to mimo on deepseek connect/timeout/5xx/429 failures; streaming excluded" },
      {
        "name": "llm-cost", "enabled": true, "notes": "per-request cost tracking; deepseek billed in usd, mimo billed in credit",
        "config": {
          "rate_card_version": "provider-standard-2026-06-08",
          "rate_units": [{ "provider": "deepseek", "unit": "usd" }, { "provider": "mimo", "unit": "credit" }],
          "rates": [
            { "provider": "deepseek", "model": "deepseek-v4-pro",   "input": 0.435, "output": 0.87 },
            { "provider": "deepseek", "model": "deepseek-v4-flash", "input": 0.14,  "output": 0.28 },
            { "provider": "mimo",     "model": "mimo-v2.5-pro",     "input": 300,   "output": 600  },
            { "provider": "mimo",     "model": "mimo-v2.5",         "input": 100,   "output": 200  }
          ],
          "cached_rates": [
            { "provider": "deepseek", "model": "deepseek-v4-pro",   "cache_read": 0.003625 },
            { "provider": "deepseek", "model": "deepseek-v4-flash", "cache_read": 0.0028   },
            { "provider": "mimo",     "model": "mimo-v2.5-pro",     "cache_read": 2.5      },
            { "provider": "mimo",     "model": "mimo-v2.5",         "cache_read": 2.0      }
          ]
        }
      }
    ],
    "configured_providers": ["deepseek", "mimo"],
    "gateway": {
      "upstreams": [
        { "name": "deepseek_server", "server": "api.deepseek.com:443", "ssl_name": "api.deepseek.com", "keepalive": 32 },
        { "name": "mimo_server",     "server": "token-plan-cn.xiaomimimo.com:443", "ssl_name": "token-plan-cn.xiaomimimo.com", "keepalive": 32 }
      ],
      "credentials": [
        { "provider": "deepseek", "api_key": "env:DEEPSEEK_API_KEY" },
        { "provider": "mimo",     "api_key": "env:MIMO_API_KEY" }
      ],
      "routes": [
        {
          "location": "/v1/chat/completions",
          "provider": "deepseek",
          "dialect": "openai",
          "upstream": "deepseek_server",
          "auth_fail_closed": true,
          "secondary_providers": [{ "provider": "mimo", "upstream": "mimo_server" }],
          "fallback": {
            "mode": "basic",
            "route": ["deepseek", "mimo", "mimo-v2.5-pro"],
            "on": ["connect_error", "transport_timeout", "upstream_5xx", "rate_limited"],
            "max_attempts": 2,
            "allow_streaming": false
          }
        }
      ]
    }
  },
  "organizations": [
    {
      "organization_id": "30000000-0000-0000-0000-000000000001",
      "organization_slug": "acme",
      "organization_name": "Acme AI Labs",
      "environment_id": "acme-prod",
      "status": "active",
      "runtime": {},
      "quotas": [
        { "scope_type": "project", "project_id": "30000000-0000-0000-0001-000000000001", "monthly_spend_limit": 800,    "monthly_spend_unit": "usd",    "enforcement_mode": "enforce", "notes": "deepseek monthly spend hard cap" },
        { "scope_type": "project", "project_id": "30000000-0000-0000-0001-000000000001", "monthly_spend_limit": 100000, "monthly_spend_unit": "credit", "enforcement_mode": "enforce", "notes": "mimo monthly credit hard cap" },
        { "scope_type": "project", "project_id": "30000000-0000-0000-0001-000000000001", "rpm_limit": 300, "tpm_limit": 250000, "enforcement_mode": "enforce", "model_allowlist": ["deepseek-v4-pro", "deepseek-v4-flash"], "notes": "rate limit for deepseek models" }
      ],
      "projects": [
        {
          "project_id": "30000000-0000-0000-0001-000000000001",
          "project_slug": "ai-platform",
          "project_name": "AI Platform",
          "status": "active",
          "clients": [
            { "client_id": "30000000-0000-0001-0001-000000000001", "client_name": "AI Platform Gateway Key", "client_type": "gateway_key", "status": "active", "api_keys": [{ "key_id": "da-sk-acme-ai-platform", "tier": "basic", "status": "active" }] }
          ]
        }
      ]
    }
  ]
}
```
</div>
</div>

<script>
(function() {
  var tabs = document.currentScript.parentElement;
  tabs.querySelectorAll('.doc-tab-button').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = this.getAttribute('data-tab');
      tabs.querySelectorAll('.doc-tab-button').forEach(function(b) { b.classList.remove('active'); });
      tabs.querySelectorAll('.doc-tab-panel').forEach(function(p) { p.classList.remove('active'); });
      this.classList.add('active');
      tabs.querySelector('.doc-tab-panel[data-tab="' + idx + '"]').classList.add('active');
    });
  });
})();
</script>



## Rendered nginx.conf

```nginx
# generated by nginz provisioning
# manifest_id: acme-prod
# deployment_id: acme-prod-meter-fallback-001
# environment_id: acme-prod
# organizations: 1

# generated upstreams
upstream deepseek_server {
    server api.deepseek.com:443;
    keepalive 32;
}

upstream mimo_server {
    server token-plan-cn.xiaomimimo.com:443;
    keepalive 32;
}

# generated globals

llm_metrics_zone metrics 1m;
llm_cost_backend postgres;
llm_cost_dsn "host=nginz-db port=5432 dbname=darkanchor user=postgres password=changeme";
llm_cost_table llm_cost_events;
llm_cost_rate_card_version provider-standard-2026-06-08;
llm_cost_rate_unit deepseek usd;
llm_cost_rate_unit mimo credit;
llm_cost_rate deepseek deepseek-v4-pro 0.435 0.87;
llm_cost_rate deepseek deepseek-v4-flash 0.14 0.28;
llm_cost_rate mimo mimo-v2.5-pro 300 600;
llm_cost_rate mimo mimo-v2.5 100 200;
llm_cost_cached_rate deepseek deepseek-v4-pro 0.003625;
llm_cost_cached_rate deepseek deepseek-v4-flash 0.0028;
llm_cost_cached_rate mimo mimo-v2.5-pro 2.5;
llm_cost_cached_rate mimo mimo-v2.5 2;

# generated client auth base
map $http_authorization $da_gateway_bearer_token {
    "~^Bearer[ \t]+(.+)$" $1;
    default "";
}

map $da_gateway_bearer_token $da_gateway_credential {
    default $da_gateway_bearer_token;
    "" $http_x_api_key;
}

map $da_gateway_credential $da_client_auth_status {
    default invalid;
    include /runtime/generated/issuer/status.map;
}

map $da_gateway_credential $da_client_auth_key_id {
    default "";
    include /runtime/generated/issuer/key-id.map;
}

map $da_gateway_credential $da_client_auth_org_slug {
    default "";
    include /runtime/generated/issuer/org-slug.map;
}

map $da_gateway_credential $da_client_auth_project_slug {
    default "";
    include /runtime/generated/issuer/project-slug.map;
}

map $da_gateway_credential $da_client_auth_client_id {
    default "";
    include /runtime/generated/issuer/client-id.map;
}

map $da_gateway_credential $da_client_auth_tier {
    default "";
    include /runtime/generated/issuer/tier.map;
}

# generated manifest-driven gateway servers
log_format manifest_gateway_json escape=json
    '{'
        '"time":"$time_iso8601",'
        '"org":"$org_id",'
        '"project":"$project_id",'
        '"client":"$client_id",'
        '"gateway_key_id":"$gateway_key_id",'
        '"provider":"$llm_effective_provider",'
        '"model":"$llm_effective_model",'
        '"rate_limit_reason":"$llm_ratelimit_deny_reason",'
        '"request_remaining":"$llm_ratelimit_quota_remaining",'
        '"token_remaining":"$llm_ratelimit_token_quota_remaining",'
        '"fallback_attempted":"$llm_fallback_attempted",'
        '"fallback_reason":"$llm_fallback_reason",'
        '"fallback_effective":"$llm_fallback_effective_provider",'
        '"input_cost":"$llm_cost_prompt",'
        '"output_cost":"$llm_cost_completion",'
        '"total_cost":"$llm_cost_total",'
        '"cost_status":"$llm_cost_status",'
        '"status":"$status",'
        '"request_time":"$request_time"'
    '}';

access_log /var/log/nginx/manifest-gateway.log manifest_gateway_json;

server {
    listen 80;
    server_name ai-platform.gateway.internal;

    location /v1/chat/completions {
        if ($da_client_auth_status = invalid) {
            return 401;
        }
        if ($da_client_auth_status = suspended) {
            return 403;
        }
        if ($da_client_auth_status = revoked) {
            return 403;
        }
        if ($da_client_auth_project_slug != "ai-platform") {
            return 403;
        }
        if ($da_client_auth_org_slug != "acme") {
            return 403;
        }

        set $tenant_id $da_client_auth_project_slug;
        set $project_id $da_client_auth_project_slug;
        set $org_id $da_client_auth_org_slug;
        set $client_id $da_client_auth_client_id;
        set $gateway_key_id $da_client_auth_key_id;

        llm_proxy;
        llm_proxy_route deepseek deepseek_server;
        llm_proxy_route mimo mimo_server;
        llm_proxy_model_pattern deepseek-v4-pro deepseek;
        llm_proxy_model_pattern deepseek-v4-flash deepseek;
        llm_proxy_model_pattern mimo-v2.5-pro mimo;
        llm_proxy_model_pattern mimo-v2.5 mimo;
        llm_proxy_default_provider deepseek;
        llm_proxy_max_body_size 64k;
        llm_proxy_inject_usage on;

        llm_fallback;
        llm_fallback_mode basic;
        llm_fallback_route deepseek mimo mimo-v2.5-pro;
        llm_fallback_on connect_error transport_timeout upstream_5xx rate_limited;
        llm_fallback_max_attempts 2;
        llm_fallback_allow_streaming off;

        llm_auth;
        llm_auth_provider deepseek;
        llm_auth_credential deepseek env:DEEPSEEK_API_KEY;
        llm_auth_credential mimo env:MIMO_API_KEY;
        llm_auth_org $org_id;
        llm_auth_project $project_id;
        llm_auth_fail_closed on;

        llm_ratelimit;
        llm_ratelimit_key $tenant_id;
        llm_ratelimit_requests_per_minute 600;
        llm_ratelimit_tokens_per_minute 500000;
        llm_ratelimit_burst_requests 120;
        llm_ratelimit_reserve_tokens 2000;
        llm_ratelimit_model_rpm deepseek-v4-pro 300;
        llm_ratelimit_model_tpm deepseek-v4-pro 250000;
        llm_ratelimit_model_rpm deepseek-v4-flash 300;
        llm_ratelimit_model_tpm deepseek-v4-flash 250000;

        llm_ratelimit_spend_scope project usd $org_id $project_id 800;
        llm_ratelimit_spend_scope project credit $org_id $project_id 100000;

        llm_ratelimit_model_basis effective;
        llm_ratelimit_fail_open off;

        llm_metrics;
        llm_metrics_emit_usage on;
        llm_metrics_label_model on;

        llm_cost;
        llm_cost_identity $gateway_key_id;
        llm_cost_org $org_id;
        llm_cost_project $project_id;
        llm_cost_client $client_id;
        llm_cost_team $project_id;
        llm_cost_auth_fingerprint $llm_auth_key_fingerprint;

        proxy_next_upstream error timeout http_500 http_502 http_503 http_429;
        proxy_next_upstream_tries 2;
        proxy_pass https://$llm_provider_upstream;
        proxy_set_header Host $llm_provider_host;
        proxy_ssl_server_name on;
        proxy_buffering off;
    }
}
```
