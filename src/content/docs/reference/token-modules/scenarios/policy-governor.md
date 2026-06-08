---
title: Policy-Governor
description: Anthropic and OpenAI behind one organization, with two projects that have different native-model allowlists and quotas.
---

# Policy-Governor

## Use Case

This scenario is for one organization that already has both Anthropic and OpenAI provider accounts. The organization wants two internal projects behind the same gateway, with different model policies for each project.

Each project exposes a single gateway hostname. Clients configure that hostname as their API base URL and use their SDK normally — there is no provider-specific prefix to manage. The Anthropic SDK calls `/v1/messages` and the OpenAI SDK calls `/v1/chat/completions`, both against the same host. Each path locks the ingress dialect with `llm_proxy_dialect_mode fixed`, so a request with the wrong body format reaches the upstream as-is and is rejected immediately at the provider level. This scenario does not configure cross-provider request translation or response normalization.

The organization has five allowed models:

| Provider | Model | Input / 1M tokens | Cached input / 1M tokens | Output / 1M tokens |
|---|---:|---:|---:|---:|
| Anthropic | `claude-haiku-4-5` | USD 1.00 | USD 0.10 | USD 5.00 |
| Anthropic | `claude-sonnet-4-6` | USD 3.00 | USD 0.30 | USD 15.00 |
| Anthropic | `claude-opus-4-8` | USD 5.00 | USD 0.50 | USD 25.00 |
| OpenAI | `gpt-5.4-mini` | USD 0.75 | USD 0.075 | USD 4.50 |
| OpenAI | `gpt-5.4` | USD 2.50 | USD 0.25 | USD 15.00 |

Rates are copied from the official OpenAI API pricing page and Anthropic Claude API pricing page on June 7, 2026. Replace them with the customer account's contracted rate card if their agreement differs from public pricing.

The two projects use different policy envelopes:

| Project | Allowed models | Policy intent |
|---|---|---|
| Restricted Core Apps | `claude-haiku-4-5`, `gpt-5.4-mini` | Restrict production applications to the lower-cost native model on each provider. |
| Governed Lab Apps | `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-8`, `gpt-5.4-mini`, `gpt-5.4` | Allow the platform/lab project to use the full approved model set with tighter limits on premium models. |

The rendered gateway config enforces the per-project model allowlist through `llm_proxy_model_pattern`, enforces the per-model RPM/TPM limits through `llm_ratelimit_model_*` directives, and enforces each project's monthly spend budget through gateway-local spend counters.

Each project gets its own server block with its own hostname. The hostname selects the policy envelope — the model allowlist and rate limits are static per server block, so different projects can carry different policies in the same gateway process. Identity is always resolved from the credential: the gateway reads the project slug and org slug from the issuer maps and checks them against the server's expected values. A credential issued for `restricted-core` that reaches `governed-lab.gateway.internal` is rejected with 403 before any upstream request is made. This means clients cannot escape their policy envelope by pointing at a different project hostname.

Replace the organization IDs, project/client names, gateway key IDs, provider endpoint environment variables, and rate card values with your own values. The manifest stores gateway key IDs only; issue raw gateway credentials with the provisioning issuer so the secret part is generated and stored in the runtime issuer maps.

Keep `deployment.gateway.upstreams[].ssl_name` set to the TLS hostname for each provider. In this scenario Anthropic uses `api.anthropic.com` and OpenAI uses `api.openai.com`. The renderer turns those values into `proxy_ssl_name`; removing or mismatching them can cause HTTPS handshake failures even when the upstream `server` value looks correct.

After applying this scenario and issuing credentials, internal clients configure the gateway as their API base URL:

| Project | API base URL | Credential to issue |
|---|---|---|
| Restricted Core Apps | `http://restricted-core.gateway.internal` | `da-sk-acme-restricted-core.<issued-secret>` |
| Governed Lab Apps | `http://governed-lab.gateway.internal` | `da-sk-acme-governed-lab.<issued-secret>` |

Set the API base URL in the SDK and leave the path as-is. The Anthropic SDK sends to `/v1/messages` and the OpenAI SDK sends to `/v1/chat/completions` — both work against the same hostname without any additional configuration.

Use `Authorization: Bearer <credential>` for the gateway credential. The prefix before the dot is the `key_id` from the manifest. The secret suffix is printed once by `packaging/provision/issue.ts --display-once`; it is not stored in the manifest and should not be checked into source control.
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
  company: "Acme AI Platform"
  contact: "platform@acme.example"
  product: enterprise

deployment:
  environment_id: acme-prod
  environment_name: "Acme Production"
  deployment_id: "acme-prod-policy-governor-001"
  product_version: "1.0.6"
  enabled_features:
    - name: llm-auth
      enabled: true
      notes: gateway credentials are separated from upstream provider keys
    - name: llm-proxy
      enabled: true
      notes: native Anthropic and OpenAI routes without cross-provider translation
    - name: llm-ratelimit
      enabled: true
      notes: project-specific per-model request and token limits
    - name: llm-cost
      enabled: true
      notes: per-request accounting using the provider rate cards below
      config:
        rate_card_version: provider-standard-2026-06-07
        rate_units:
          - { provider: anthropic, unit: usd }
          - { provider: openai,    unit: usd }
        rates:
          - { provider: anthropic, model: claude-haiku-4-5,  input: 1.00, output:  5.00 }
          - { provider: anthropic, model: claude-sonnet-4-6, input: 3.00, output: 15.00 }
          - { provider: anthropic, model: claude-opus-4-8,   input: 5.00, output: 25.00 }
          - { provider: openai,    model: gpt-5.4-mini,      input: 0.75, output:  4.50 }
          - { provider: openai,    model: gpt-5.4,           input: 2.50, output: 15.00 }
        cached_rates:
          - { provider: anthropic, model: claude-haiku-4-5,  cache_read: 0.10  }
          - { provider: anthropic, model: claude-sonnet-4-6, cache_read: 0.30  }
          - { provider: anthropic, model: claude-opus-4-8,   cache_read: 0.50  }
          - { provider: openai,    model: gpt-5.4-mini,      cache_read: 0.075 }
          - { provider: openai,    model: gpt-5.4,           cache_read: 0.25  }
  configured_providers:
    - anthropic
    - openai
  gateway:
    upstreams:
      - name: anthropic_api
        server: api.anthropic.com:443
        ssl_name: api.anthropic.com
        keepalive: 32
      - name: openai_api
        server: api.openai.com:443
        ssl_name: api.openai.com
        keepalive: 32
    credentials:
      - provider: anthropic
        api_key: env:ANTHROPIC_API_KEY
      - provider: openai
        api_key: env:OPENAI_API_KEY
    routes:
      - location: /v1/messages
        provider: anthropic
        dialect: anthropic
        upstream: anthropic_api
        ingress_dialect: anthropic
        normalize_response: false
        auth_fail_closed: true
      - location: /v1/chat/completions
        provider: openai
        dialect: openai
        upstream: openai_api
        ingress_dialect: openai
        normalize_response: false
        auth_fail_closed: true

organizations:
  - organization_id: "20000000-0000-0000-0000-000000000001"
    organization_slug: acme
    organization_name: "Acme AI Platform"
    environment_id: acme-prod
    status: active
    runtime: {}
    quotas:
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000001"
        monthly_spend_limit: 2500
        monthly_spend_unit: usd
        enforcement_mode: enforce
        notes: restricted project monthly spend budget
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000002"
        monthly_spend_limit: 8000
        monthly_spend_unit: usd
        enforcement_mode: enforce
        notes: governed lab monthly spend budget
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000001"
        rpm_limit: 120
        tpm_limit: 60000
        enforcement_mode: enforce
        model_allowlist:
          - claude-haiku-4-5
        notes: restricted project Anthropic model budget
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000001"
        rpm_limit: 160
        tpm_limit: 80000
        enforcement_mode: enforce
        model_allowlist:
          - gpt-5.4-mini
        notes: restricted project OpenAI model budget
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000002"
        rpm_limit: 180
        tpm_limit: 90000
        enforcement_mode: enforce
        model_allowlist:
          - claude-haiku-4-5
        notes: lab project Anthropic Haiku budget
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000002"
        rpm_limit: 80
        tpm_limit: 70000
        enforcement_mode: enforce
        model_allowlist:
          - claude-sonnet-4-6
        notes: lab project Anthropic Sonnet budget
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000002"
        rpm_limit: 24
        tpm_limit: 40000
        enforcement_mode: enforce
        model_allowlist:
          - claude-opus-4-8
        notes: lab project Anthropic Opus budget
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000002"
        rpm_limit: 220
        tpm_limit: 110000
        enforcement_mode: enforce
        model_allowlist:
          - gpt-5.4-mini
        notes: lab project OpenAI mini budget
      - scope_type: project
        project_id: "20000000-0000-0000-0001-000000000002"
        rpm_limit: 70
        tpm_limit: 65000
        enforcement_mode: enforce
        model_allowlist:
          - gpt-5.4
        notes: lab project OpenAI large model budget
    projects:
      - project_id: "20000000-0000-0000-0001-000000000001"
        project_slug: restricted-core
        project_name: "Restricted Core Apps"
        status: active
        clients:
          - client_id: "20000000-0000-0001-0001-000000000001"
            client_name: "Restricted Core Gateway Key"
            client_type: gateway_key
            status: active
            api_keys:
              - key_id: da-sk-acme-restricted-core
                tier: basic
                status: active
      - project_id: "20000000-0000-0000-0001-000000000002"
        project_slug: governed-lab
        project_name: "Governed Lab Apps"
        status: active
        clients:
          - client_id: "20000000-0000-0001-0001-000000000002"
            client_name: "Governed Lab Gateway Key"
            client_type: gateway_key
            status: active
            api_keys:
              - key_id: da-sk-acme-governed-lab
                tier: basic
                status: active
```
</div>
<div class="doc-tab-panel" data-tab="1">

```json
{
  "customer": {
    "serial": "replace-with-customer-serial",
    "company": "Acme AI Platform",
    "contact": "platform@acme.example",
    "product": "enterprise"
  },
  "deployment": {
    "environment_id": "acme-prod",
    "environment_name": "Acme Production",
    "deployment_id": "acme-prod-policy-governor-001",
    "product_version": "1.0.6",
    "enabled_features": [
      { "name": "llm-auth", "enabled": true, "notes": "gateway credentials are separated from upstream provider keys" },
      { "name": "llm-proxy", "enabled": true, "notes": "native Anthropic and OpenAI routes without cross-provider translation" },
      { "name": "llm-ratelimit", "enabled": true, "notes": "project-specific per-model request and token limits" },
      {
        "name": "llm-cost", "enabled": true, "notes": "per-request accounting using the provider rate cards below",
        "config": {
          "rate_card_version": "provider-standard-2026-06-07",
          "rate_units": [{ "provider": "anthropic", "unit": "usd" }, { "provider": "openai", "unit": "usd" }],
          "rates": [
            { "provider": "anthropic", "model": "claude-haiku-4-5",  "input": 1,   "output": 5  },
            { "provider": "anthropic", "model": "claude-sonnet-4-6", "input": 3,   "output": 15 },
            { "provider": "anthropic", "model": "claude-opus-4-8",   "input": 5,   "output": 25 },
            { "provider": "openai",    "model": "gpt-5.4-mini",      "input": 0.75,"output": 4.5},
            { "provider": "openai",    "model": "gpt-5.4",           "input": 2.5, "output": 15 }
          ],
          "cached_rates": [
            { "provider": "anthropic", "model": "claude-haiku-4-5",  "cache_read": 0.1   },
            { "provider": "anthropic", "model": "claude-sonnet-4-6", "cache_read": 0.3   },
            { "provider": "anthropic", "model": "claude-opus-4-8",   "cache_read": 0.5   },
            { "provider": "openai",    "model": "gpt-5.4-mini",      "cache_read": 0.075 },
            { "provider": "openai",    "model": "gpt-5.4",           "cache_read": 0.25  }
          ]
        }
      }
    ],
    "configured_providers": ["anthropic", "openai"],
    "gateway": {
      "upstreams": [
        { "name": "anthropic_api", "server": "api.anthropic.com:443", "ssl_name": "api.anthropic.com", "keepalive": 32 },
        { "name": "openai_api",    "server": "api.openai.com:443",    "ssl_name": "api.openai.com",    "keepalive": 32 }
      ],
      "credentials": [
        { "provider": "anthropic", "api_key": "env:ANTHROPIC_API_KEY" },
        { "provider": "openai",    "api_key": "env:OPENAI_API_KEY" }
      ],
      "routes": [
        { "location": "/v1/messages",          "provider": "anthropic", "dialect": "anthropic", "upstream": "anthropic_api", "ingress_dialect": "anthropic", "normalize_response": false, "auth_fail_closed": true },
        { "location": "/v1/chat/completions",  "provider": "openai",    "dialect": "openai",    "upstream": "openai_api",    "ingress_dialect": "openai",    "normalize_response": false, "auth_fail_closed": true }
      ]
    }
  },
  "organizations": [
    {
      "organization_id": "20000000-0000-0000-0000-000000000001",
      "organization_slug": "acme",
      "organization_name": "Acme AI Platform",
      "environment_id": "acme-prod",
      "status": "active",
      "runtime": {},
      "quotas": [
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000001", "monthly_spend_limit": 2500, "monthly_spend_unit": "usd", "enforcement_mode": "enforce", "notes": "restricted project monthly spend budget" },
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000002", "monthly_spend_limit": 8000, "monthly_spend_unit": "usd", "enforcement_mode": "enforce", "notes": "governed lab monthly spend budget" },
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000001", "rpm_limit": 120, "tpm_limit": 60000,  "enforcement_mode": "enforce", "model_allowlist": ["claude-haiku-4-5"],  "notes": "restricted project Anthropic model budget" },
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000001", "rpm_limit": 160, "tpm_limit": 80000,  "enforcement_mode": "enforce", "model_allowlist": ["gpt-5.4-mini"],      "notes": "restricted project OpenAI model budget" },
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000002", "rpm_limit": 180, "tpm_limit": 90000,  "enforcement_mode": "enforce", "model_allowlist": ["claude-haiku-4-5"],  "notes": "lab project Anthropic Haiku budget" },
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000002", "rpm_limit": 80,  "tpm_limit": 70000,  "enforcement_mode": "enforce", "model_allowlist": ["claude-sonnet-4-6"], "notes": "lab project Anthropic Sonnet budget" },
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000002", "rpm_limit": 24,  "tpm_limit": 40000,  "enforcement_mode": "enforce", "model_allowlist": ["claude-opus-4-8"],   "notes": "lab project Anthropic Opus budget" },
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000002", "rpm_limit": 220, "tpm_limit": 110000, "enforcement_mode": "enforce", "model_allowlist": ["gpt-5.4-mini"],      "notes": "lab project OpenAI mini budget" },
        { "scope_type": "project", "project_id": "20000000-0000-0000-0001-000000000002", "rpm_limit": 70,  "tpm_limit": 65000,  "enforcement_mode": "enforce", "model_allowlist": ["gpt-5.4"],           "notes": "lab project OpenAI large model budget" }
      ],
      "projects": [
        {
          "project_id": "20000000-0000-0000-0001-000000000001",
          "project_slug": "restricted-core",
          "project_name": "Restricted Core Apps",
          "status": "active",
          "clients": [
            { "client_id": "20000000-0000-0001-0001-000000000001", "client_name": "Restricted Core Gateway Key", "client_type": "gateway_key", "status": "active", "api_keys": [{ "key_id": "da-sk-acme-restricted-core", "tier": "basic", "status": "active" }] }
          ]
        },
        {
          "project_id": "20000000-0000-0000-0001-000000000002",
          "project_slug": "governed-lab",
          "project_name": "Governed Lab Apps",
          "status": "active",
          "clients": [
            { "client_id": "20000000-0000-0001-0001-000000000002", "client_name": "Governed Lab Gateway Key", "client_type": "gateway_key", "status": "active", "api_keys": [{ "key_id": "da-sk-acme-governed-lab", "tier": "basic", "status": "active" }] }
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
# deployment_id: acme-prod-policy-governor-001
# environment_id: acme-prod
# organizations: 1

# generated upstreams
upstream anthropic_api {
    server api.anthropic.com:443;
    keepalive 32;
}

upstream openai_api {
    server api.openai.com:443;
    keepalive 32;
}

# generated globals

llm_metrics_zone metrics 1m;
llm_cost_backend postgres;
llm_cost_dsn "host=nginz-db port=5432 dbname=darkanchor user=postgres password=changeme";
llm_cost_table llm_cost_events;
llm_cost_rate_card_version provider-standard-2026-06-07;
llm_cost_rate_unit anthropic usd;
llm_cost_rate_unit openai usd;
llm_cost_rate anthropic claude-haiku-4-5 1 5;
llm_cost_rate anthropic claude-sonnet-4-6 3 15;
llm_cost_rate anthropic claude-opus-4-8 5 25;
llm_cost_rate openai gpt-5.4-mini 0.75 4.5;
llm_cost_rate openai gpt-5.4 2.5 15;
llm_cost_cached_rate anthropic claude-haiku-4-5 0.1;
llm_cost_cached_rate anthropic claude-sonnet-4-6 0.3;
llm_cost_cached_rate anthropic claude-opus-4-8 0.5;
llm_cost_cached_rate openai gpt-5.4-mini 0.075;
llm_cost_cached_rate openai gpt-5.4 0.25;

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
    server_name restricted-core.gateway.internal;

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
        if ($da_client_auth_project_slug != "restricted-core") {
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
        llm_ratelimit_requests_per_minute 120;
        llm_ratelimit_tokens_per_minute 60000;
        llm_ratelimit_burst_requests 24;
        llm_ratelimit_reserve_tokens 2000;
        llm_ratelimit_model_rpm claude-haiku-4-5 120;
        llm_ratelimit_model_tpm claude-haiku-4-5 60000;
        llm_ratelimit_spend_scope project usd $org_id $project_id 2500;

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
        if ($da_client_auth_project_slug != "restricted-core") {
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
        llm_proxy_route openai openai_api;
        llm_proxy_model_pattern gpt-5.4-mini openai;
        llm_proxy_dialect_mode fixed;
        llm_proxy_ingress_dialect openai;
        llm_proxy_max_body_size 64k;
        llm_proxy_inject_usage on;
        llm_proxy_normalize_response off;

        llm_auth;
        llm_auth_provider openai;
        llm_auth_credential openai env:OPENAI_API_KEY;
        llm_auth_org $org_id;
        llm_auth_project $project_id;
        llm_auth_fail_closed on;

        llm_ratelimit;
        llm_ratelimit_key $tenant_id;
        llm_ratelimit_requests_per_minute 160;
        llm_ratelimit_tokens_per_minute 80000;
        llm_ratelimit_burst_requests 32;
        llm_ratelimit_reserve_tokens 2000;
        llm_ratelimit_model_rpm gpt-5.4-mini 160;
        llm_ratelimit_model_tpm gpt-5.4-mini 80000;
        llm_ratelimit_spend_scope project usd $org_id $project_id 2500;

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
        proxy_ssl_name api.openai.com;
        proxy_pass https://openai_api;
        proxy_set_header Host api.openai.com;
        proxy_buffering off;
    }
}

server {
    listen 80;
    server_name governed-lab.gateway.internal;

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
        if ($da_client_auth_project_slug != "governed-lab") {
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
        llm_ratelimit_requests_per_minute 284;
        llm_ratelimit_tokens_per_minute 200000;
        llm_ratelimit_burst_requests 56;
        llm_ratelimit_reserve_tokens 2000;
        llm_ratelimit_model_rpm claude-haiku-4-5 180;
        llm_ratelimit_model_tpm claude-haiku-4-5 90000;
        llm_ratelimit_model_rpm claude-sonnet-4-6 80;
        llm_ratelimit_model_tpm claude-sonnet-4-6 70000;
        llm_ratelimit_model_rpm claude-opus-4-8 24;
        llm_ratelimit_model_tpm claude-opus-4-8 40000;
        llm_ratelimit_spend_scope project usd $org_id $project_id 8000;

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
        if ($da_client_auth_project_slug != "governed-lab") {
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
        llm_proxy_route openai openai_api;
        llm_proxy_model_pattern gpt-5.4-mini openai;
        llm_proxy_model_pattern gpt-5.4 openai;
        llm_proxy_dialect_mode fixed;
        llm_proxy_ingress_dialect openai;
        llm_proxy_max_body_size 64k;
        llm_proxy_inject_usage on;
        llm_proxy_normalize_response off;

        llm_auth;
        llm_auth_provider openai;
        llm_auth_credential openai env:OPENAI_API_KEY;
        llm_auth_org $org_id;
        llm_auth_project $project_id;
        llm_auth_fail_closed on;

        llm_ratelimit;
        llm_ratelimit_key $tenant_id;
        llm_ratelimit_requests_per_minute 290;
        llm_ratelimit_tokens_per_minute 175000;
        llm_ratelimit_burst_requests 58;
        llm_ratelimit_reserve_tokens 2000;
        llm_ratelimit_model_rpm gpt-5.4-mini 220;
        llm_ratelimit_model_tpm gpt-5.4-mini 110000;
        llm_ratelimit_model_rpm gpt-5.4 70;
        llm_ratelimit_model_tpm gpt-5.4 65000;
        llm_ratelimit_spend_scope project usd $org_id $project_id 8000;

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
        proxy_ssl_name api.openai.com;
        proxy_pass https://openai_api;
        proxy_set_header Host api.openai.com;
        proxy_buffering off;
    }
}
```
