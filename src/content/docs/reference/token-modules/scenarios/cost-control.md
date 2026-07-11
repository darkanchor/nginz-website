---
title: Cost-Control
description: One provider, one project, one gateway credential, and per-model quota enforcement for a small team.
---

# Cost-Control

## Use Case

This scenario is for a team using one OpenAI account behind one internal gateway project.

The team wants a single OpenAI-compatible endpoint for its applications, but it does not want the project to have unlimited access to every model. The gateway accepts the team's gateway credentials, forwards traffic to OpenAI with the operator-owned OpenAI API key, records cost by organization, project, client, and gateway key, and applies different project-level request and token limits for each allowed model.

The example exposes two OpenAI models:

| Model | Intended use | RPM | TPM |
|---|---|---:|---:|
| `gpt-5.4-mini` | Default team work | 260 | 120,000 |
| `gpt-5.4` | Higher-quality work | 40 | 60,000 |

All three quotas are project-level constraints on the Team AI project: one monthly spend cap (scoped by cost unit) and per-model RPM and TPM limits on each model.

| Cost unit | Monthly cap |
|---|---:|
| USD | 1,200 |

The rendered gateway config enforces RPM, TPM, model allowlist, and the project monthly spend budget. Spend enforcement is gateway-local, reset by the gateway's local calendar month, and tracked in the configured cost unit.

Quota policies accept these enforcement modes:

| `enforcement_mode` | Meaning | Use it when |
|---|---|---|
| `enforce` | Apply the request and token limits at the gateway. Requests over the configured RPM/TPM policy are denied by the rate-limit module. | You want the gateway to actively protect the project budget and provider account. This scenario uses `enforce`. |
| `monitor` | Store the quota policy for reporting and review without using it as a gateway deny policy. | You want to observe current usage before turning on active blocking. |

Replace the organization IDs, project/client names, gateway key IDs, rate card, and `OPENAI_API_KEY` value with your own values. The manifest stores gateway key IDs only; issue raw gateway credentials with the provisioning issuer so the secret part is generated and stored in the runtime issuer maps.

Keep `deployment.gateway.upstreams[].ssl_name` set to the provider hostname used for TLS SNI. For OpenAI, keep `ssl_name: api.openai.com` unless your account uses a different upstream hostname. The renderer turns this into `proxy_ssl_name`; removing or mismatching it can cause HTTPS handshake failures even when the upstream `server` value looks correct.

The renderer applies the manifest from `deployment.gateway.upstreams`, `deployment.gateway.credentials`, `deployment.gateway.routes`, organizations, projects, clients, and quota policies.

If your only provider is Anthropic instead of OpenAI, use the same structure: change the provider name, upstream host, credential environment variable, model names, endpoint dialect, and rate card to Anthropic values, then keep the same project/client credential and per-model quota pattern.

After applying this scenario and issuing credentials, internal clients should call the gateway at:

| Client | Gateway URL | Credential to issue | Header |
|---|---|---|---|
| Team AI Gateway Key | `http://team-ai.gateway.internal/v1/chat/completions` | `da-sk-acme-team.<issued-secret>` | `Authorization: Bearer da-sk-acme-team.<issued-secret>` |

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
  company: "Acme AI Team"
  contact: "platform@acme.example"
  product: enterprise

deployment:
  environment_id: acme-prod
  environment_name: "Acme Production"
  deployment_id: "acme-prod-llm-gateway-001"
  product_version: "1.0.6"
  enabled_features:
    - name: llm-auth
      enabled: true
      notes: gateway credentials are separated from the OpenAI upstream key
    - name: llm-proxy
      enabled: true
      notes: one OpenAI endpoint with an explicit two-model catalog
    - name: llm-ratelimit
      enabled: true
      notes: project quotas plus per-model request and token limits
    - name: llm-cost
      enabled: true
      notes: per-request accounting using the OpenAI rate card below
      config:
        rate_card_version: openai-standard-2026-06-07
        rate_units:
          - { provider: openai, unit: usd }
        rates:
          - { provider: openai, model: gpt-5.4-mini, input: 0.75, output:  4.50 }
          - { provider: openai, model: gpt-5.4,      input: 2.50, output: 15.00 }
        cached_rates:
          - { provider: openai, model: gpt-5.4-mini, cache_read: 0.075 }
          - { provider: openai, model: gpt-5.4,      cache_read: 0.25  }
  configured_providers:
    - openai
  gateway:
    upstreams:
      - name: openai_api
        server: api.openai.com:443
        ssl_name: api.openai.com
        keepalive: 32
    credentials:
      - provider: openai
        api_key: env:OPENAI_API_KEY
    routes:
      - location: /v1/chat/completions
        provider: openai
        dialect: openai
        upstream: openai_api
        auth_fail_closed: true

organizations:
  - organization_id: "10000000-0000-0000-0000-000000000001"
    organization_slug: acme
    organization_name: "Acme AI Team"
    environment_id: acme-prod
    status: active
    runtime: {}
    quotas:
      - scope_type: project
        project_id: "10000000-0000-0000-0001-000000000001"
        monthly_spend_limit: 1200
        monthly_spend_unit: usd
        enforcement_mode: enforce
        notes: monthly project spend budget for the shared team project
      - scope_type: project
        project_id: "10000000-0000-0000-0001-000000000001"
        rpm_limit: 260
        tpm_limit: 120000
        enforcement_mode: enforce
        model_allowlist:
          - gpt-5.4-mini
        notes: default model budget for the shared team project
      - scope_type: project
        project_id: "10000000-0000-0000-0001-000000000001"
        rpm_limit: 40
        tpm_limit: 60000
        enforcement_mode: enforce
        model_allowlist:
          - gpt-5.4
        notes: high-capability model budget for the shared team project
    projects:
      - project_id: "10000000-0000-0000-0001-000000000001"
        project_slug: team-ai
        project_name: "Team AI"
        status: active
        clients:
          - client_id: "10000000-0000-0001-0001-000000000001"
            client_name: "Team AI Gateway Key"
            client_type: gateway_key
            status: active
            api_keys:
              - key_id: da-sk-acme-team
                tier: basic
                status: active
```
</div>
<div class="doc-tab-panel" data-tab="1">

```json
{
  "customer": {
    "serial": "replace-with-customer-serial",
    "company": "Acme AI Team",
    "contact": "platform@acme.example",
    "product": "enterprise"
  },
  "deployment": {
    "environment_id": "acme-prod",
    "environment_name": "Acme Production",
    "deployment_id": "acme-prod-llm-gateway-001",
    "product_version": "1.0.6",
    "enabled_features": [
      { "name": "llm-auth", "enabled": true, "notes": "gateway credentials are separated from the OpenAI upstream key" },
      { "name": "llm-proxy", "enabled": true, "notes": "one OpenAI endpoint with an explicit two-model catalog" },
      { "name": "llm-ratelimit", "enabled": true, "notes": "project quotas plus per-model request and token limits" },
      {
        "name": "llm-cost",
        "enabled": true,
        "notes": "per-request accounting using the OpenAI rate card below",
        "config": {
          "rate_card_version": "openai-standard-2026-06-07",
          "rate_units": [{ "provider": "openai", "unit": "usd" }],
          "rates": [
            { "provider": "openai", "model": "gpt-5.4-mini", "input": 0.75, "output": 4.5 },
            { "provider": "openai", "model": "gpt-5.4",      "input": 2.5,  "output": 15 }
          ],
          "cached_rates": [
            { "provider": "openai", "model": "gpt-5.4-mini", "cache_read": 0.075 },
            { "provider": "openai", "model": "gpt-5.4",      "cache_read": 0.25 }
          ]
        }
      }
    ],
    "configured_providers": ["openai"],
    "gateway": {
      "upstreams": [
        { "name": "openai_api", "server": "api.openai.com:443", "ssl_name": "api.openai.com", "keepalive": 32 }
      ],
      "credentials": [
        { "provider": "openai", "api_key": "env:OPENAI_API_KEY" }
      ],
      "routes": [
        { "location": "/v1/chat/completions", "provider": "openai", "dialect": "openai", "upstream": "openai_api", "auth_fail_closed": true }
      ]
    }
  },
  "organizations": [
    {
      "organization_id": "10000000-0000-0000-0000-000000000001",
      "organization_slug": "acme",
      "organization_name": "Acme AI Team",
      "environment_id": "acme-prod",
      "status": "active",
      "runtime": {},
      "quotas": [
        { "scope_type": "project", "project_id": "10000000-0000-0000-0001-000000000001", "monthly_spend_limit": 1200, "monthly_spend_unit": "usd", "enforcement_mode": "enforce", "notes": "monthly project spend budget for the shared team project" },
        { "scope_type": "project", "project_id": "10000000-0000-0000-0001-000000000001", "rpm_limit": 260, "tpm_limit": 120000, "enforcement_mode": "enforce", "model_allowlist": ["gpt-5.4-mini"], "notes": "default model budget for the shared team project" },
        { "scope_type": "project", "project_id": "10000000-0000-0000-0001-000000000001", "rpm_limit": 40, "tpm_limit": 60000, "enforcement_mode": "enforce", "model_allowlist": ["gpt-5.4"], "notes": "high-capability model budget for the shared team project" }
      ],
      "projects": [
        {
          "project_id": "10000000-0000-0000-0001-000000000001",
          "project_slug": "team-ai",
          "project_name": "Team AI",
          "status": "active",
          "clients": [
            { "client_id": "10000000-0000-0001-0001-000000000001", "client_name": "Team AI Gateway Key", "client_type": "gateway_key", "status": "active", "api_keys": [{ "key_id": "da-sk-acme-team", "tier": "basic", "status": "active" }] }
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
# deployment_id: acme-prod-llm-gateway-001
# environment_id: acme-prod
# organizations: 1

# generated upstreams
upstream openai_api {
    server api.openai.com:443;
    keepalive 32;
}

# generated globals

llm_metrics_zone metrics 1m;
llm_cost_backend postgres;
llm_cost_dsn "host=nginz-db port=5432 dbname=darkanchor user=postgres password=changeme";
llm_cost_table llm_cost_events;
llm_cost_rate_card_version openai-standard-2026-06-07;
llm_cost_rate_unit openai usd;
llm_cost_rate openai gpt-5.4-mini 0.75 4.5;
llm_cost_rate openai gpt-5.4 2.5 15;
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

server {
    listen 80;
    server_name team-ai.gateway.internal;

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
        if ($da_client_auth_project_slug != "team-ai") {
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
        llm_proxy_max_body_size 64k;
        llm_proxy_inject_usage on;

        llm_auth;
        llm_auth_provider openai;
        llm_auth_credential openai env:OPENAI_API_KEY;
        llm_auth_org $org_id;
        llm_auth_project $project_id;
        llm_auth_fail_closed on;

        llm_ratelimit;
        llm_ratelimit_key $tenant_id;
        llm_ratelimit_requests_per_minute 300;
        llm_ratelimit_tokens_per_minute 180000;
        llm_ratelimit_burst_requests 60;
        llm_ratelimit_reserve_tokens 2000;
        llm_ratelimit_model_rpm gpt-5.4-mini 260;
        llm_ratelimit_model_tpm gpt-5.4-mini 120000;
        llm_ratelimit_model_rpm gpt-5.4 40;
        llm_ratelimit_model_tpm gpt-5.4 60000;
        llm_ratelimit_spend_scope project usd $org_id $project_id 1200;

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
