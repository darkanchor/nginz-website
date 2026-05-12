---
title: Authz (Authorization Policy Engine)
description: Policy-based authorization for nginx written in Gleam. Define access rules as pure functions, compose them into policies, and enforce decisions at the edge before requests reach your application.
---

# Authz (Authorization Policy Engine)

Use this module when nginx is your front door and you need that front door to make access decisions consistently. Rules are pure functions, policies are compositions of rules, and the final answer is always one of two values: Allow or Deny with a specific reason.

## When to use this module

- You want to centralize access policy in one place instead of scattering checks across nginx config, application code, and middleware.
- You need role-based access control backed by JWT claims or OIDC identity.
- You want to call an external policy service (like OPA) and cache the result.
- You need to compose multiple access signals into a single decision: method, path, identity claims, query parameters, remote address, WAF results, and nftset allowlist facts.
- You want policy logic that is fully unit-testable without nginx.
- You need to verify session cookies as an identity source for access decisions.

## nginx.conf synthesis

### Basic method allowlist

The simplest policy: restrict a route to standard HTTP methods.

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from authz.js;

    server {
        listen 8888;

        location /api/ {
            js_content main.check;
        }
    }
}
```

`main.check` allows GET, HEAD, POST, PUT, PATCH, and DELETE. Anything else returns a deny status.

### JWT role check

Combine the native JWT module (signature verification) with policy rules (claim evaluation). The JWT module sets `$jwt_claim_*` variables; authz reads them.

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from authz.js;

    server {
        listen 8888;

        location /admin/ {
            jwt_secret "your-hmac-secret";
            jwt_claim $jwt_claim_role role;
            js_content main.jwt_check;
        }
    }
}
```

`main.jwt_check` evaluates whether the `role` claim is `admin` or `user`. The native JWT module handles signature verification; authz handles the policy.

### Remote OPA decision point

Delegate the authorization decision to an external OPA-compatible endpoint.

```nginx
location /api/ {
    set $authz_opa_url http://opa.internal:8181/v1/data/authz/allow;
    js_content main.remote_check;
}
```

The handler POSTs `{"input":{"method":"...","path":"...","remote_addr":"..."}}` and expects `{"result":{"allow":true|false}}`.

### Cached remote check with bearer token

Cache OPA decisions keyed by the SHA-256 hash of the Bearer token. Saves round trips when the same client calls repeatedly.

```nginx
http {
    js_shared_dict_zone zone=authz_cache:10m timeout=1h;

    server {
        listen 8888;

        location /api/ {
            set $authz_opa_url  http://opa.internal:8181/v1/data/authz/allow;
            set $authz_cache_ttl 300;
            js_content main.cached_remote_check;
        }
    }
}
```

The `timeout=` parameter on `js_shared_dict_zone` is required for per-key TTL support.

### Header injection with auth_request

Return enriched decision headers so downstream locations can read claims and status without re-evaluating policy.

```nginx
location /protected/ {
    auth_request     /auth;
    auth_request_set $authz_status $upstream_http_x_authz_status;
    auth_request_set $authz_role   $upstream_http_x_authz_role;
    proxy_set_header X-User-Role   $authz_role;
    proxy_pass       http://backend;
}

location = /auth {
    internal;
    set $authz_opa_url http://opa.internal:8181/v1/data/authz/allow;
    js_content main.enriched_remote_check;
}
```

Use `enriched_check`, `enriched_jwt_check`, `enriched_remote_check`, `enriched_oidc_check`, or `enriched_composed_check` to inject `X-Authz-Status` and `X-Authz-<Claim>` headers.

### Session gate

Verify a session cookie issued by the session module, using authz as the gate.

```nginx
http {
    js_shared_dict_zone zone=sessions:1m timeout=1h;
    js_import authz_main from authz.js;
    js_import session_main from session.js;

    server {
        listen 8888;

        set $session_dict sessions;
        set $session_ttl 3600;

        location /start {
            set $session_subject $arg_subject;
            js_content session_main.start;
        }

        location /gate {
            js_content authz_main.session_gate;
        }
    }
}
```

`main.session_gate` reads the session cookie, looks up the subject in the shared dict, and returns 204 with `X-Session-Subject` on success or 401 on failure.

### Composed policy shell

The canonical recipe that merges JWT + OIDC identity, query parameters, and phase-safe WAF and nftset facts into a single policy tree.

```nginx
location = /auth/composed {
    internal;

    set $jwt_claim_role      $http_x_jwt_role;
    set $jwt_claim_sub       $http_x_jwt_sub;
    set $oidc_claim_sub      $http_x_oidc_sub;
    set $oidc_claim_email    $http_x_oidc_email;
    set $oidc_claim_name     $http_x_oidc_name;
    set $waf_result          $http_x_waf_result;
    set $waf_category        $http_x_waf_category;
    set $waf_rule_id         $http_x_waf_rule_id;
    set $waf_score           $http_x_waf_score;
    set $nftset_result       $http_x_nftset_result;
    set $nftset_matched_set  $http_x_nftset_matched_set;

    js_content main.enriched_composed_check;
}
```

JWT claims take precedence over OIDC claims on key collisions. The handler also injects `X-Authz-*` headers for downstream consumers. In production, the variable values come from trusted native modules, not directly from client headers.

### WAF and nftset allow-path checks

Read native security module results and allow or deny based on the WAF or nftset verdict.

```nginx
location /waf-check {
    js_content main.waf_check;
}

location /nftset-check {
    js_content main.nftset_check;
}
```

`main.waf_check` passes on `allowed` or `dryrun`, denies on `denied`. `main.nftset_check` passes on `allow` or absent, denies otherwise.

## Public Gleam API

The module source lives in `modules/authz/src/`. Every handler is registered through a single `exports()` function that returns an njs-compatible JavaScript object.

### `nginz_njs_authz.exports()` (the nginx adapter)

Returns a JavaScript object mapping handler names to functions. This is what `js_import main from authz.js` binds. Each handler reads nginx variables, evaluates policy, and writes the response.

Exported handlers:

| Handler        | Type              | Behavior |
|----------------|-------------------|----------|
| `check`        | sync              | Method allowlist. Denies non-standard methods. |
| `jwt_check`    | sync              | Reads `$jwt_claim_role`. Allows admin or user role. |
| `remote_check` | async (Promise)   | POSTs context to `$authz_opa_url`. |
| `cached_remote_check` | async        | Like `remote_check`, cached by Bearer token SHA-256. |
| `enriched_check` | sync            | `check` plus `X-Authz-Status` header. |
| `enriched_jwt_check` | sync        | `jwt_check` plus `X-Authz-Status` and `X-Authz-<Claim>` headers. |
| `enriched_remote_check` | async    | `remote_check` plus `X-Authz-Status` header. |
| `session_gate` | sync              | Verifies session cookie via shared dict. 204 + `X-Session-Subject` or 401. |
| `oidc_check`   | sync              | Reads `$oidc_claim_sub`. Requires subject to be present. |
| `enriched_oidc_check` | sync       | `oidc_check` plus `X-Authz-Status` and `X-Authz-<Claim>` headers. |
| `enriched_composed_check` | sync   | Canonical composed policy: JWT + OIDC + query + WAF + nftset. |
| `waf_check`    | sync              | Allow-path WAF check. Reads `$waf_result`. |
| `enriched_waf_check` | sync         | `waf_check` plus WAF fact headers. |
| `nftset_check` | sync              | Allow-path nftset check. Reads `$nftset_result`. |

### `authz/policy` (core DSL)

The foundational types and combinators.

**Types:**

- `Decision` -- `Allow` or `Deny(status: Int, reason: String)`
- `Context` -- method, path, remote_addr, headers, claims, query
- `Rule` -- `fn(Context) -> Decision`
- `AsyncRule` -- `fn(Context) -> Promise(Decision)`

**Evaluation:**

- `evaluate(ctx, rules)` -- short-circuits on first Deny
- `async_evaluate(ctx, rules)` -- async variant with short-circuit
- `to_async(rule)` -- lifts a sync Rule into an AsyncRule

**Atomic rules:**

- `method_in(methods)` -- allow if request method is in the list
- `path_prefix(prefix)` -- allow if request path starts with prefix
- `require_header(name, value)` -- allow if header equals value exactly
- `header_one_of(name, values)` -- allow if header is one of the values
- `has_claim(key, value)` -- allow if claim equals value exactly
- `claim_one_of(key, values)` -- allow if claim is one of the values
- `claim_contains(key, value)` -- allow if comma-separated claim contains value as a segment
- `claim_contains_one_of(key, values)` -- allow if comma-separated claim contains any value from the list
- `claim_present(key)` -- allow if claim is non-empty; returns Deny(401, ...) when absent
- `query_param(key, value)` -- allow if query parameter equals value exactly
- `query_param_one_of(key, values)` -- allow if query parameter is one of the values
- `remote_addr_in(cidrs)` -- allow if remote address matches a CIDR (`"10.0.0.0/8"` or plain IP)

**Combinators:**

- `all_of(rules)` -- allow only if every rule allows (AND)
- `any_of(rules)` -- allow if at least one rule allows (OR)
- `not_(rule)` -- invert a rule
- `observe(rule)` -- log the decision without changing it

**Helpers:**

- `deny_401(reason)` -- construct a Deny with status 401
- `deny_403(reason)` -- construct a Deny with status 403

### `authz/claims`

- `from_request(r, names)` -- extracts `$jwt_claim_<name>` nginx variables into a claims dictionary

### `authz/query`

- `from_request(r, names)` -- extracts `$arg_<name>` nginx variables into a query dictionary

### `authz/remote`

- `opa_allow(ctx, endpoint, timeout_ms)` -- async OPA-compatible remote check via `http_client`

### `authz/cache`

- `lookup(dict_name, token)` -- shared dict lookup by Bearer token SHA-256
- `store(dict_name, token, decision, ttl_s)` -- persists decision with per-key TTL

### `authz/enrich`

- `inject_status(r, decision)` -- sets `X-Authz-Status` response header
- `inject_claims(r, ctx)` -- sets `X-Authz-<Claim>` headers for each claim in context
- `inject_waf_facts(r, fact)` -- sets `X-Authz-Waf-*` headers
- `inject_nftset_facts(r, fact)` -- sets `X-Authz-Nftset-*` headers

### `authz/subrequest`

- `auth_request_step(r, path)` -- builds an AsyncRule backed by nginx subrequest; 2xx becomes Allow, anything else Deny(403)

### `authz/oidc`

- `from_request(r)` -- reads `$oidc_claim_sub`, `$oidc_claim_email`, `$oidc_claim_name` into a claims dictionary
- `identity_from_request(r)` -- returns a typed `OidcIdentity`

### `authz/identity`

- `from_request(r)` -- builds a Context from the raw request
- `with_jwt(r, jwt_claim_names)` -- builds a Context with JWT claims
- `with_oidc(r)` -- builds a Context with OIDC claims
- `with_jwt_and_oidc(r, jwt_names, oidc_names)` -- merges OIDC first, then JWT (JWT wins on duplicate keys)

### `authz/security`

- `waf_from_request(r)` -- parses `$waf_*` variables into a typed `WafFact`
- `nftset_from_request(r)` -- parses `$nftset_*` variables into a typed `NftsetFact`
- `waf_pass(fact)` -- allow-path decision; dry-run counts as pass
- `nftset_pass(fact)` -- allow-path decision; absent result counts as pass
- `waf_pass_rule(r)` -- Rule factory for policy tree composition
- `nftset_pass_rule(r)` -- Rule factory for policy tree composition

## Works well with

- Stock nginx `auth_request`, `satisfy`, and `allow`/`deny` — authz adds composable, testable policy rules on top of nginx's built-in access control primitives.
- Stock nginx `map` — use `map` to convert authz decisions into routing or header values.
- [JWT Authentication](/docs/reference/modules/jwt) for cryptographic token verification that feeds claims into policy rules.
- [OpenID Connect](/docs/reference/modules/oidc) for the full OIDC discovery and redirect flow that populates identity claims.
- [Session](/docs/reference/scripted-modules/session) for cookie-based session lifecycle that authz can gate on.
- [Web Application Firewall](/docs/reference/modules/waf) for allow-path WAF signals composed into policy trees.
- [NFTset Access Control](/docs/reference/modules/nftset) for allow-path nftset signals composed into policy trees.
- [Feature Flags](/docs/reference/scripted-modules/feature-flags) when policy decisions should depend on rollout state or experiment assignment.
- [NJS Orchestration](/docs/reference/modules/njs) when you need subrequests or custom orchestration alongside authorization.
