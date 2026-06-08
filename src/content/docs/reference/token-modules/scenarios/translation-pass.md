---
title: Translation-Pass
description: One Anthropic provider serving both Anthropic SDK and OpenAI SDK clients behind the same hostname, with OpenAI-to-Anthropic translation and response normalization.
---

# Translation-Pass

## Use Case

This scenario is for an organization that has one Anthropic account and wants to serve both Anthropic SDK clients and OpenAI SDK clients behind the same gateway hostname without requiring clients to change their SDK or rewrite request bodies.

One org, one project, one gateway credential. Clients configure the gateway hostname as their API base URL. The gateway infers the dialect from the URL path:

- Clients using the Anthropic SDK hit `/v1/messages` — the gateway passes the request through natively to Anthropic without any body transformation.
- Clients using the OpenAI SDK hit `/v1/chat/completions` — the gateway translates the OpenAI-format request body to Anthropic format, forwards it, and normalizes the Anthropic response back to OpenAI format before returning it to the client.

Both paths reach the same Anthropic upstream. Clients do not need to know which path the other SDK uses.

The three allowed models:

| Provider | Model | Input / 1M tokens | Cached input / 1M tokens | Output / 1M tokens |
|---|---:|---:|---:|---:|
| Anthropic | `claude-haiku-4-5` | USD 1.00 | USD 0.10 | USD 5.00 |
| Anthropic | `claude-sonnet-4-6` | USD 3.00 | USD 0.30 | USD 15.00 |
| Anthropic | `claude-opus-4-8` | USD 5.00 | USD 0.50 | USD 25.00 |

Rates match the Anthropic Claude API pricing page as of June 7, 2026.

Per-model project limits and the monthly spend budget apply across both paths — a request made through `/v1/chat/completions` counts against the same quota as one made through `/v1/messages`.

| Model | Project RPM | Project TPM | Monthly spend |
|---|---:|---:|---:|
| `claude-haiku-4-5` | 200 | 100,000 | — |
| `claude-sonnet-4-6` | 100 | 80,000 | — |
| `claude-opus-4-8` | 30 | 50,000 | — |
| All models combined | — | — | USD 5,000 |

After applying this scenario and issuing credentials, internal clients configure the gateway as their API base URL:

| Client | API base URL | Credential to issue |
|---|---|---|
| Unified Gateway Key | `http://unified.gateway.internal` | `da-sk-acme-unified.<issued-secret>` |

Set the API base URL in the SDK and leave the path as-is. The Anthropic SDK sends to `/v1/messages` and the OpenAI SDK sends to `/v1/chat/completions` — both work against the same hostname. Use `Authorization: Bearer <credential>` for the gateway credential.

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
  company: "Acme AI Services"
  contact: "platform@acme.example"
  product: enterprise

deployment:
  environment_id: acme-prod
  environment_name: "Acme Production"
  deployment_id: "acme-prod-translation-pass-001"
  product_version: "1.0.6"
  enabled_features:
    - name: llm-auth
      enabled: true
      notes: gateway credentials are separated from the Anthropic upstream key
    - name: llm-proxy
      enabled: true
      notes: Anthropic native pass-through on /v1/messages; OpenAI-to-Anthropic translation with response normalization on /v1/chat/completions
    - name: llm-ratelimit
      enabled: true
      notes: per-model request and token limits shared across both paths
    - name: llm-cost
      enabled: true
      notes: per-request accounting using the Anthropic rate card below
      config:
        rate_card_version: anthropic-standard-2026-06-07
        rate_units:
          - { provider: anthropic, unit: usd }
        rates:
          - { provider: anthropic, model: claude-haiku-4-5,  input: 1.00, output:  5.00 }
          - { provider: anthropic, model: claude-sonnet-4-6, input: 3.00, output: 15.00 }
          - { provider: anthropic, model: claude-opus-4-8,   input: 5.00, output: 25.00 }
        cached_rates:
          - { provider: anthropic, model: claude-haiku-4-5,  cache_read: 0.10 }
          - { provider: anthropic, model: claude-sonnet-4-6, cache_read: 0.30 }
          - { provider: anthropic, model: claude-opus-4-8,   cache_read: 0.50 }
  configured_providers:
    - anthropic
  gateway:
    upstreams:
      - name: anthropic_api
        server: api.anthropic.com:443
        ssl_name: api.anthropic.com
        keepalive: 32
    credentials:
      - provider: anthropic
        api_key: env:ANTHROPIC_API_KEY
    routes:
      - location: /v1/messages
        provider: anthropic
        dialect: anthropic
        upstream: anthropic_api
        ingress_dialect: anthropic
        normalize_response: false
        auth_fail_closed: true
      - location: /v1/chat/completions
        provider: anthropic
        dialect: anthropic
        upstream: anthropic_api
        ingress_dialect: openai
        normalize_response: true
        auth_fail_closed: true

organizations:
  - organization_id: "40000000-0000-0000-0000-000000000001"
    organization_slug: acme
    organization_name: "Acme AI Services"
    environment_id: acme-prod
    status: active
    runtime: {}
    quotas:
      - scope_type: project
        project_id: "40000000-0000-0000-0001-000000000001"
        monthly_spend_limit: 5000
        monthly_spend_unit: usd
        enforcement_mode: enforce
        notes: combined monthly spend budget across both endpoint paths
      - scope_type: project
        project_id: "40000000-0000-0000-0001-000000000001"
        rpm_limit: 200
        tpm_limit: 100000
        enforcement_mode: enforce
        model_allowlist:
          - claude-haiku-4-5
        notes: haiku budget shared across both paths
      - scope_type: project
        project_id: "40000000-0000-0000-0001-000000000001"
        rpm_limit: 100
        tpm_limit: 80000
        enforcement_mode: enforce
        model_allowlist:
          - claude-sonnet-4-6
        notes: sonnet budget shared across both paths
      - scope_type: project
        project_id: "40000000-0000-0000-0001-000000000001"
        rpm_limit: 30
        tpm_limit: 50000
        enforcement_mode: enforce
        model_allowlist:
          - claude-opus-4-8
        notes: opus budget shared across both paths
    projects:
      - project_id: "40000000-0000-0000-0001-000000000001"
        project_slug: unified
        project_name: "Unified Gateway"
        status: active
        clients:
          - client_id: "40000000-0000-0001-0001-000000000001"
            client_name: "Unified Gateway Key"
            client_type: gateway_key
            status: active
            api_keys:
              - key_id: da-sk-acme-unified
                tier: basic
                status: active
```
</div>
<div class="doc-tab-panel" data-tab="1">

```json
{
  "customer": {
    "serial": "replace-with-customer-serial",
    "company": "Acme AI Services",
    "contact": "platform@acme.example",
    "product": "enterprise"
  },
  "deployment": {
    "environment_id": "acme-prod",
    "environment_name": "Acme Production",
    "deployment_id": "acme-prod-translation-pass-001",
    "product_version": "1.0.6",
    "enabled_features": [
      { "name": "llm-auth", "enabled": true, "notes": "gateway credentials are separated from the Anthropic upstream key" },
      { "name": "llm-proxy", "enabled": true, "notes": "Anthropic native pass-through on /v1/messages; OpenAI-to-Anthropic translation with response normalization on /v1/chat/completions" },
      { "name": "llm-ratelimit", "enabled": true, "notes": "per-model request and token limits shared across both paths" },
      {
        "name": "llm-cost", "enabled": true, "notes": "per-request accounting using the Anthropic rate card below",
        "config": {
          "rate_card_version": "anthropic-standard-2026-06-07",
          "rate_units": [{ "provider": "anthropic", "unit": "usd" }],
          "rates": [
            { "provider": "anthropic", "model": "claude-haiku-4-5",  "input": 1, "output": 5  },
            { "provider": "anthropic", "model": "claude-sonnet-4-6", "input": 3, "output": 15 },
            { "provider": "anthropic", "model": "claude-opus-4-8",   "input": 5, "output": 25 }
          ],
          "cached_rates": [
            { "provider": "anthropic", "model": "claude-haiku-4-5",  "cache_read": 0.1 },
            { "provider": "anthropic", "model": "claude-sonnet-4-6", "cache_read": 0.3 },
            { "provider": "anthropic", "model": "claude-opus-4-8",   "cache_read": 0.5 }
          ]
        }
      }
    ],
    "configured_providers": ["anthropic"],
    "gateway": {
      "upstreams": [
        { "name": "anthropic_api", "server": "api.anthropic.com:443", "ssl_name": "api.anthropic.com", "keepalive": 32 }
      ],
      "credentials": [
        { "provider": "anthropic", "api_key": "env:ANTHROPIC_API_KEY" }
      ],
      "routes": [
        { "location": "/v1/messages",         "provider": "anthropic", "dialect": "anthropic", "upstream": "anthropic_api", "ingress_dialect": "anthropic", "normalize_response": false, "auth_fail_closed": true },
        { "location": "/v1/chat/completions", "provider": "anthropic", "dialect": "anthropic", "upstream": "anthropic_api", "ingress_dialect": "openai",    "normalize_response": true,  "auth_fail_closed": true }
      ]
    }
  },
  "organizations": [
    {
      "organization_id": "40000000-0000-0000-0000-000000000001",
      "organization_slug": "acme",
      "organization_name": "Acme AI Services",
      "environment_id": "acme-prod",
      "status": "active",
      "runtime": {},
      "quotas": [
        { "scope_type": "project", "project_id": "40000000-0000-0000-0001-000000000001", "monthly_spend_limit": 5000, "monthly_spend_unit": "usd", "enforcement_mode": "enforce", "notes": "combined monthly spend budget across both endpoint paths" },
        { "scope_type": "project", "project_id": "40000000-0000-0000-0001-000000000001", "rpm_limit": 200, "tpm_limit": 100000, "enforcement_mode": "enforce", "model_allowlist": ["claude-haiku-4-5"],  "notes": "haiku budget shared across both paths" },
        { "scope_type": "project", "project_id": "40000000-0000-0000-0001-000000000001", "rpm_limit": 100, "tpm_limit": 80000,  "enforcement_mode": "enforce", "model_allowlist": ["claude-sonnet-4-6"], "notes": "sonnet budget shared across both paths" },
        { "scope_type": "project", "project_id": "40000000-0000-0000-0001-000000000001", "rpm_limit": 30,  "tpm_limit": 50000,  "enforcement_mode": "enforce", "model_allowlist": ["claude-opus-4-8"],   "notes": "opus budget shared across both paths" }
      ],
      "projects": [
        {
          "project_id": "40000000-0000-0000-0001-000000000001",
          "project_slug": "unified",
          "project_name": "Unified Gateway",
          "status": "active",
          "clients": [
            { "client_id": "40000000-0000-0001-0001-000000000001", "client_name": "Unified Gateway Key", "client_type": "gateway_key", "status": "active", "api_keys": [{ "key_id": "da-sk-acme-unified", "tier": "basic", "status": "active" }] }
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
# deployment_id: acme-prod-translation-pass-001
# environment_id: acme-prod
# organizations: 1

# generated upstreams
upstream anthropic_api {
    server api.anthropic.com:443;
    keepalive 32;
}

# generated globals

llm_metrics_zone metrics 1m;
llm_cost_backend postgres;
llm_cost_dsn "host=nginz-db port=5432 dbname=darkanchor user=postgres password=changeme";
llm_cost_table llm_cost_events;
llm_cost_rate_card_version anthropic-standard-2026-06-07;
llm_cost_rate_unit anthropic usd;
llm_cost_rate anthropic claude-haiku-4-5 1 5;
llm_cost_rate anthropic claude-sonnet-4-6 3 15;
llm_cost_rate anthropic claude-opus-4-8 5 25;
llm_cost_cached_rate anthropic claude-haiku-4-5 0.1;
llm_cost_cached_rate anthropic claude-sonnet-4-6 0.3;
llm_cost_cached_rate anthropic claude-opus-4-8 0.5;

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
    server_name unified.gateway.internal;

    location /v1/messages {
        if ($da_client_auth_status = invalid) {
            return 401;
        }
        if ($da_client_auth_status = suspended) {
            return 403;
        }
        if ($da_client_auth_status = revoked) {
            return 403;
        }
        if ($da_client_auth_project_slug != "unified") {
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
        llm_proxy_route anthropic anthropic_api anthropic;
        llm_proxy_model_pattern claude-haiku-4-5 anthropic;
        llm_proxy_model_pattern claude-sonnet-4-6 anthropic;
        llm_proxy_model_pattern claude-opus-4-8 anthropic;
        llm_proxy_dialect_mode fixed;
        llm_proxy_ingress_dialect anthropic;
        llm_proxy_max_body_size 64k;
        llm_proxy_inject_usage on;
        llm_proxy_normalize_response off;

        llm_auth;
        llm_auth_provider anthropic;
        llm_auth_credential anthropic env:ANTHROPIC_API_KEY;
        llm_auth_org $org_id;
        llm_auth_project $project_id;
        llm_auth_fail_closed on;

        llm_ratelimit;
        llm_ratelimit_key $tenant_id;
        llm_ratelimit_requests_per_minute 330;
        llm_ratelimit_tokens_per_minute 230000;
        llm_ratelimit_burst_requests 66;
        llm_ratelimit_reserve_tokens 2000;
        llm_ratelimit_model_rpm claude-haiku-4-5 200;
        llm_ratelimit_model_tpm claude-haiku-4-5 100000;
        llm_ratelimit_model_rpm claude-sonnet-4-6 100;
        llm_ratelimit_model_tpm claude-sonnet-4-6 80000;
        llm_ratelimit_model_rpm claude-opus-4-8 30;
        llm_ratelimit_model_tpm claude-opus-4-8 50000;
        llm_ratelimit_spend_scope project usd $org_id $project_id 5000;

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

        proxy_ssl_server_name on;
        proxy_ssl_name api.anthropic.com;
        proxy_pass https://anthropic_api;
        proxy_set_header Host api.anthropic.com;
        proxy_buffering off;
    }

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
        if ($da_client_auth_project_slug != "unified") {
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
        llm_proxy_route anthropic anthropic_api anthropic;
        llm_proxy_model_pattern claude-haiku-4-5 anthropic;
        llm_proxy_model_pattern claude-sonnet-4-6 anthropic;
        llm_proxy_model_pattern claude-opus-4-8 anthropic;
        llm_proxy_dialect_mode fixed;
        llm_proxy_ingress_dialect openai;
        llm_proxy_max_body_size 64k;
        llm_proxy_inject_usage on;
        llm_proxy_normalize_response on;

        llm_auth;
        llm_auth_provider anthropic;
        llm_auth_credential anthropic env:ANTHROPIC_API_KEY;
        llm_auth_org $org_id;
        llm_auth_project $project_id;
        llm_auth_fail_closed on;

        llm_ratelimit;
        llm_ratelimit_key $tenant_id;
        llm_ratelimit_requests_per_minute 330;
        llm_ratelimit_tokens_per_minute 230000;
        llm_ratelimit_burst_requests 66;
        llm_ratelimit_reserve_tokens 2000;
        llm_ratelimit_model_rpm claude-haiku-4-5 200;
        llm_ratelimit_model_tpm claude-haiku-4-5 100000;
        llm_ratelimit_model_rpm claude-sonnet-4-6 100;
        llm_ratelimit_model_tpm claude-sonnet-4-6 80000;
        llm_ratelimit_model_rpm claude-opus-4-8 30;
        llm_ratelimit_model_tpm claude-opus-4-8 50000;
        llm_ratelimit_spend_scope project usd $org_id $project_id 5000;

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

        proxy_ssl_server_name on;
        proxy_ssl_name api.anthropic.com;
        proxy_pass https://anthropic_api;
        proxy_set_header Host api.anthropic.com;
        proxy_buffering off;
    }
}
```
