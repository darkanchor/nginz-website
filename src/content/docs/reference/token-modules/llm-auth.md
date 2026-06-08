---
title: llm-auth
description: Provider credential resolution and upstream credential injection, with tenant, org, and project-scoped credential selection.
---

# llm-auth

Use this module when the credential your customer sends to the gateway is not the credential the upstream LLM provider should see. `llm-auth` owns the credential-policy boundary: which upstream credential source applies, what to do when credentials are missing, and how auth status is made visible without exposing secrets.

## When to use this module

- You need to strip gateway-facing credentials before proxying to upstream providers.
- You have multiple tenants, each with their own provider API keys, and need tenant-scoped credential resolution.
- You want org/project/client credential cascading: client BYOK → project key → org key → shared fallback.
- You need to rotate provider credentials without touching application code.
- You require audit-safe auth status reporting: `$llm_auth_key_fingerprint` provides a stable non-secret identifier for the resolved secret.
- You support `literal`, `env:`, and `file:` secret sources and want explicit failure reasons when resolution fails.

## nginx.conf synthesis

Basic shared provider credential mapping with fail-closed enforcement.

```nginx
location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_auth;
    llm_auth_credential openai    sk-my-openai-key;
    llm_auth_credential anthropic sk-ant-my-anthropic-key;
    llm_auth_fail_closed on;

    proxy_pass https://$llm_provider_upstream;
}
```

Tenant-scoped credentials with shared fallback. When the tenant has no explicit credential, the shared provider key is used.

```nginx
location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_auth;
    llm_auth_credential openai    sk-shared-openai;
    llm_auth_credential anthropic sk-ant-shared;
    llm_auth_tenant $http_x_tenant_id;
    llm_auth_tenant_credential tenant-a openai    sk-tenant-a-key;
    llm_auth_tenant_credential tenant-b anthropic sk-ant-tenant-b-key;
    llm_auth_tenant_fallback_shared on;
    llm_auth_fail_closed on;

    proxy_pass https://$llm_provider_upstream;
}
```

Org/project/client credential cascade with environment-backed secrets.

```nginx
location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_auth;
    llm_auth_org $http_x_org_id;
    llm_auth_project $http_x_project_id;

    # Shared provider credentials as fallback
    llm_auth_credential openai    env:OPENAI_SHARED_KEY;
    llm_auth_credential anthropic env:ANTHROPIC_SHARED_KEY;

    # Org-level credentials
    llm_auth_org_credential org-acme openai    env:ACME_OPENAI_KEY;

    # Project-level credentials (override org)
    llm_auth_project_credential proj-ml openai env:ML_TEAM_OPENAI_KEY;

    llm_auth_fail_closed on;

    proxy_pass https://$llm_provider_upstream;
}
```

## Directive reference

### Core directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_auth` | `location` | — | Enable the module for this location. |
| `llm_auth_provider` | `location` | — | Explicit provider hint. When set, this is authoritative; otherwise the provider is read from `llm-proxy`'s per-request context. |
| `llm_auth_fail_closed` | `location` | `off` | When `on`, returns 500 if provider or credential cannot be resolved. When `off`, the request proceeds (gateway credential is still stripped before upstream send). |

### Credential binding

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_auth_credential` | `location` | — | Bind a shared provider credential identifier. The value can be a literal string, `env:VARNAME`, or `file:/path/to/secret`. Repeatable per provider. |
| `llm_auth_tenant_credential` | `location` | — | Bind a tenant-specific provider credential. Args: `<tenant> <provider> <credential>`. Repeatable. |
| `llm_auth_project_credential` | `location` | — | Bind a project-specific provider credential. Args: `<project> <provider> <credential>`. Repeatable. |
| `llm_auth_org_credential` | `location` | — | Bind an org-specific provider credential. Args: `<org> <provider> <credential>`. Repeatable. |

### Identity binding

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_auth_tenant` | `location` | — | nginx variable that provides the tenant identity string (e.g., `$http_x_tenant_id`). |
| `llm_auth_project` | `location` | — | nginx variable that provides the project identity string. |
| `llm_auth_org` | `location` | — | nginx variable that provides the org identity string. |

### Policy directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_auth_tenant_fallback_shared` | `location` | `off` | When `on`, allows falling back to shared provider credentials when no tenant-specific credential matches. When `off`, missing tenant credential fails according to `llm_auth_fail_closed`. |

## Exported variables

| Variable | Description |
|---|---|
| `$llm_auth_provider` | Provider observed by the auth module. |
| `$llm_auth_credential` | Configured non-secret credential identifier selected for the provider. |
| `$llm_auth_status` | `resolved`, `missing_provider`, `missing_credential`, or `missing_secret`. |
| `$llm_auth_key_source` | `literal`, `env`, or `file` when a credential mapping exists. |
| `$llm_auth_key_fingerprint` | Stable non-secret audit identifier for the resolved secret. Use this in log formats and as a quota key. |
| `$llm_auth_fail_reason` | `provider_missing`, `credential_missing`, `client_credential_missing`, `project_credential_missing`, `org_credential_missing`, or `secret_unresolved`. |
| `$llm_auth_client` | Client identity from `llm_auth_tenant`. |
| `$llm_auth_project` | Project identity from `llm_auth_project`. |
| `$llm_auth_org` | Org identity from `llm_auth_org`. |

## Behavior notes

- Credential resolution order: client/BYOK → project → org → shared provider credential. The first matching credential wins.
- `llm_auth` locations reject nginx subrequests in `PREACCESS` because policy resolution depends on ACCESS-phase state that subrequests do not run.
- Gateway-facing `Authorization` and `x-api-key` headers are stripped before upstream proxying. This is executed in `llm-proxy`'s body handler using auth-owned policy.
- OpenAI upstreams receive `Authorization: Bearer <cred>`. Anthropic upstreams receive `x-api-key: <cred>` plus `anthropic-version`.
- Secret sources (`literal`, `env:`, `file:`) are resolved at config-parse time. Reload nginx to pick up new secret values.
- `$llm_auth_key_fingerprint` is intentionally non-secret and stable. Use it for quota keys, cost attribution, and audit logs — never expose it as a raw credential.
- Debug logs never contain raw provider credentials. The module suppresses HTTP debug traces for auth-managed requests.
- Startup validation rejects invalid tenant/project/org credential combinations.
- When tenants must not share spend or quota identity, use `llm_auth_tenant` plus `llm_auth_tenant_credential` so auth resolution is tenant-scoped. Then key `llm_cost_identity` and `llm_ratelimit_key` from `$llm_auth_key_fingerprint`, not raw client headers.
