---
title: OpenID Connect
description: Authenticate users through any OpenID Connect provider using the authorization code flow with encrypted session cookies.
---

# OpenID Connect

Use this module when your application needs user authentication through an external identity provider and you want nginx to handle the full OIDC relying-party flow.

## When to use this module

- You want to delegate authentication to an external IdP (like Okta, Keycloak, or Azure AD) without adding middleware to every service.
- You need the standard authorization code flow with state, nonce, and PKCE protection.
- You want user identity available as nginx variables for logging, header injection, or access decisions.
- You need encrypted cookie-based sessions so users are not prompted on every request.
- You prefer a module that fails closed when discovery or token verification cannot complete.

## nginx.conf synthesis

Configure OIDC on a protected location with your IdP details.

```nginx
location /app {
    oidc on;
    oidc_discovery https://idp.example.com/.well-known/openid-configuration;
    oidc_client_id my-client;
    oidc_client_secret my-secret;
    oidc_redirect_uri https://app.example.com/callback;
    oidc_cookie_secret 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef;

    proxy_set_header X-User-Sub $oidc_claim_sub;
    proxy_set_header X-User-Email $oidc_claim_email;
    proxy_set_header X-User-Name $oidc_claim_name;

    proxy_pass http://backend;
}
```

The module redirects unauthenticated users to the IdP, handles the callback, validates the ID token, and sets an encrypted session cookie. Subsequent requests with a valid session skip the redirect.

## Directive reference

### `oidc`

- **Contexts:** `location`
- **Default:** `off`

Enables OIDC authentication for this location. When turned on, unauthenticated requests are redirected to the identity provider.

### `oidc_discovery`

- **Contexts:** `location`
- **Default:** none

URL of the provider's OpenID Connect discovery document. The module fetches this at runtime to determine the authorization, token, and JWKS endpoints.

### `oidc_client_id`

- **Contexts:** `location`
- **Default:** none

The OAuth 2.0 client identifier assigned by your identity provider.

### `oidc_client_secret`

- **Contexts:** `location`
- **Default:** none

The client secret for your OAuth 2.0 application. Keep this value out of version control and use nginx's secure variable loading when possible.

### `oidc_redirect_uri`

- **Contexts:** `location`
- **Default:** none

The callback URI where the IdP sends users after authentication. This must match the redirect URI registered with your identity provider.

### `oidc_scope`

- **Contexts:** `location`
- **Default:** `openid profile email`

Space-separated list of OIDC scopes to request during authentication. The defaults give you the standard identity claims. Add custom scopes if your IdP exposes additional claims.

### `oidc_cookie_name`

- **Contexts:** `location`
- **Default:** `oidc_session`

Name of the session cookie that stores the authenticated session.

### `oidc_cookie_secret`

- **Contexts:** `location`
- **Default:** none

A 64-character hex string (32 bytes) used as the AES-256-GCM encryption key for session cookies. This is required. Generate it with a secure random source and treat it like a signing key.

### `oidc_pkce`

- **Contexts:** `location`
- **Default:** `on`

Enables Proof Key for Code Exchange (PKCE) using S256. PKCE adds a layer of protection against authorization code interception attacks. There is rarely a reason to turn it off.

### Exported variables

| Variable | Description |
|---|---|
| `$oidc_claim_sub` | Subject identifier from the ID token |
| `$oidc_claim_email` | Email claim from the ID token |
| `$oidc_claim_name` | Display name from the ID token |

These variables are populated after successful authentication and can be forwarded to backends with `proxy_set_header`.

## Works well with

- [JWT Authentication](/docs/reference/modules/jwt) when some routes need bare token validation and others need the full OIDC redirect flow.
- [Web Application Firewall](/docs/reference/modules/waf) for layered security in front of authenticated applications.
- [Rate Limiting](/docs/reference/modules/ratelimit) to control authentication endpoint traffic.
- [Health Checks](/docs/reference/modules/healthcheck) for verifying that OIDC-protected routes respond as expected.
