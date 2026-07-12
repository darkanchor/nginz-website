---
title: JWT Authentication
description: Validate bearer tokens at the nginx layer, extract claims and headers, and enforce access rules before requests reach your application.
---

# JWT Authentication

Use this module when your API should accept or reject requests based on a signed JSON Web Token before the request ever touches application code.

## When to use this module

- You have a microservice or API gateway and want to centralize token validation instead of repeating it in every service.
- You need to extract claims (like user ID or role) from a token and pass them to the backend as headers.
- You want to enforce claim requirements, expiration, issuer, or audience checks at the edge.
- You need to support multiple signing algorithms including HMAC, RSA, ECDSA, or EdDSA.
- You want to fetch signing keys dynamically from a JWKS endpoint instead of keeping key files on disk.

## nginx.conf synthesis

Protect an API route with a symmetric key and extract a user ID claim.

```nginx
location /api {
    jwt_secret "your-hmac-secret";
    jwt_claim $user_id sub;
    proxy_set_header X-User-Id $user_id;
    proxy_pass http://backend;
}
```

For asymmetric keys served from a JWKS endpoint, use subrequest-based key fetching with caching.

```nginx
proxy_cache_path /tmp/jwt_cache levels=1:2 keys_zone=jwt_keys:1m inactive=5m max_size=10m;

location /jwks-cached {
    proxy_pass https://auth.example.com/.well-known/jwks.json;
    proxy_cache jwt_keys;
    proxy_cache_valid 200 5m;
    proxy_cache_use_stale error timeout updating;
    internal;
}

location /api {
    jwt_key_request /jwks-cached;
    proxy_pass http://backend;
}
```

## Directive reference

### `jwt_secret`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Enables JWT validation and sets the inline HMAC secret or token source. All nested locations inherit this setting. Use `jwt_secret off;` to explicitly disable validation for a specific block. You can also extract the token from a cookie or variable with `jwt_secret token=$cookie_name;`.

### `jwt_key_request`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Fetches signing keys from a JWKS or keyval endpoint via nginx subrequest. The response body is parsed as JWKS by default. You can pass `keyval` as a second argument for keyval format. Multiple `jwt_key_request` directives on the same location issue all subrequests in parallel. For production use, pair this with `proxy_cache` on the subrequest location, since this module does not cache keys itself.

### `jwt_claim` and `jwt_header`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Extract a claim or JOSE header from the token and store it in a variable. Supports nested dot-path lookups for complex structured claims.

```nginx
jwt_claim $user_id sub;
jwt_claim $role realm.access.role;
jwt_header $kid kid;
```

### `jwt_require_claim`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Require that a claim matches a specific value using a comparison operator. Supported operators: `eq`, `!eq`, `gt`, `lt`, `ge`, `le`.

```nginx
jwt_require_claim role eq admin;
jwt_require_claim token_version ge 2;
```

### `jwt_require` and `jwt_require_header`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

`jwt_require` rejects requests when a given variable is empty or falsy. `jwt_require_header` checks for the presence or value of a JOSE header. These give you flexible policy rules beyond simple claim matching.

### `jwt_issuer` and `jwt_audience`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Shortcuts for validating the `iss` and `aud` claims. `jwt_audience` handles both string and array-form `aud` values.

```nginx
jwt_issuer https://auth.example.com;
jwt_audience my-client-id;
```

### `jwt_validate_exp` and `jwt_validate_sig`

- **Contexts:** `http`, `server`, `location`
- **Default:** `on`

Toggles for expiration and signature validation. You would normally leave both on. Turning off signature validation is useful during development or when another layer already verified the token.

### `jwt_strict_kid`

- **Contexts:** `http`, `server`, `location`
- **Default:** `on`

Enforces deterministic signing-key selection. A token carrying `kid` must match that exact configured key, and a token without `kid` is rejected when more than one key is available. Set this to `off` only for a deliberate legacy fallback policy; doing so permits the verifier to try compatible keys when the identifier is absent or unknown.

### `jwt_leeway`

- **Contexts:** `http`, `server`, `location`
- **Default:** `0`

Adds tolerance in seconds for clock skew when checking `exp` and `nbf`. A small value like `30` is enough to cover most clock drift without weakening security.

### `jwt_revocation_list_sub` and `jwt_revocation_list_kid`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Path to a JSON file listing revoked subject identifiers or key identifiers. If the token's `sub` or `kid` appears in these files, it is rejected regardless of signature validity.

### `jwt_phase`

- **Contexts:** `http`, `server`, `location`
- **Default:** `access`

Controls whether JWT validation runs in the `access` or `preaccess` phase. Use `preaccess` when you want authentication to happen before other access checks like IP allowlists.

### Exported variables

| Variable | Description |
|---|---|
| `$jwt_claims` | Full token payload as JSON |
| `$jwt_nowtime` | Current Unix timestamp |

Use `jwt_claim` to extract individual claims into named variables. The full payload is available through `$jwt_claims` for logging or forwarding.

## Works well with

- Stock nginx `auth_request` — use JWT for token validation and `auth_request` to gate protected locations.
- Stock nginx `proxy_set_header` and `map` — forward extracted claims to backends or branch routing on claim values.
- [OpenID Connect](/docs/reference/modules/oidc) when you need the full discovery and redirect flow instead of bare token validation.
- [Web Application Firewall](/docs/reference/modules/waf) for layered request inspection alongside authentication.
- [GraphQL Gateway](/docs/reference/modules/graphql) for protecting GraphQL endpoints with token checks.
- [Rate Limiting](/docs/reference/modules/ratelimit) for per-client rate control after authentication identifies the caller.
