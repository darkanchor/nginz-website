---
title: Session (Cookie and Session Lifecycle)
description: Session-state library for nginx written in Gleam. Cookie modeling, session lifecycle policy, and an ngx.shared-backed store adapter that other modules compose for identity and targeting.
---

# Session (Cookie and Session Lifecycle)

Use this module when HTTP's stateless nature is not enough and you need request continuity. Instead of letting each feature invent its own cookie and storage rules, this module gives nginx a clear session lifecycle: one place starts the session, one place verifies it, and other modules build on that shared identity.

## When to use this module

- You need to start, verify, and end sessions with a well-defined cookie contract.
- You want to protect routes with session verification via `auth_request`.
- You need to persist rollout assignments (like canary status) alongside session data.
- You want OIDC-backed session creation that normalizes identity into a standard form.
- You need other modules like authz and feature_flags to consume session-derived identity instead of duplicating session logic.

## nginx.conf synthesis

### Basic session lifecycle

Start a session after authentication, verify it on protected routes, and end it on logout.

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_shared_dict_zone zone=sessions:4m timeout=1h;
    js_import main from session.js;

    server {
        listen 8888;

        set $session_dict sessions;
        set $session_ttl 3600;

        # After login -- set $session_subject to the authenticated user identity
        location /session/start {
            set $session_subject $authenticated_user;
            js_content main.start;
        }

        # Protect resources -- use with auth_request
        location /session/verify {
            internal;
            js_content main.verify;
        }

        location /session/end {
            js_content main.end_session;
        }
    }
}
```

`main.start` generates a random UUID-backed SHA-256 session ID, stores the subject in the shared dict with a TTL, and sets a `Set-Cookie` header. `main.verify` reads the session cookie, looks up the subject, and returns 204 with `X-Session-Subject` or 401. `main.end_session` deletes the session entry, clears the client cookie, and always returns 204.

### Session verification with auth_request

Protect application routes by delegating session check to an internal location.

```nginx
http {
    js_shared_dict_zone zone=sessions:4m timeout=1h;
    js_import main from session.js;

    server {
        listen 8888;

        set $session_dict sessions;

        location /api/ {
            auth_request /session/verify;
            auth_request_set $session_subject $upstream_http_x_session_subject;
            proxy_set_header X-Session-Subject $session_subject;
            proxy_pass http://backend;
        }

        location /session/verify {
            internal;
            js_content main.verify;
        }
    }
}
```

### Sticky canary assignment

Persist a canary assignment alongside the session so the same user stays on the same rollout path across requests.

```nginx
http {
    js_shared_dict_zone zone=sessions:4m timeout=1h;
    js_import main from session.js;

    server {
        listen 8888;

        set $session_dict sessions;
        set $session_ttl 3600;

        # Start a session first
        location /start {
            set $session_subject $arg_subject;
            js_content main.start;
        }

        # Store canary assignment: $session_canary must be "1" or "0"
        location /canary/set {
            set $session_canary $arg_c;
            js_content main.set_canary;
        }

        # Read current canary assignment: returns "1", "0", or 404 if unset
        location /canary/get {
            js_content main.get_canary;
        }

        # End session (also clears canary assignment)
        location /end {
            js_content main.end_session;
        }
    }
}
```

The canary assignment is stored under a separate key (`{sid}:canary`) with its own TTL, giving independent lifecycle control from the session subject.

### OIDC-backed session start

Create a session from a validated OIDC subject. Normalizes the identity to `"oidc:{sub}"` for consistent downstream consumption.

```nginx
http {
    js_shared_dict_zone zone=sessions:4m timeout=1h;
    js_import main from session.js;

    server {
        listen 8888;

        set $session_dict sessions;
        set $session_ttl 3600;

        # Prefers $session_oidc_sub bridge variable, falls back to native $oidc_claim_sub
        location /session/start-oidc {
            set $session_oidc_sub $http_x_oidc_sub;
            js_content main.start_oidc;
        }
    }
}
```

Returns 204 with a `Set-Cookie` header on success, 401 when the OIDC subject is empty.

### Session descriptor inspection

Get a human-readable summary of the default session configuration.

```nginx
location /session/describe {
    js_content main.describe;
}
```

Returns a string like `"sid backend=shared_dict ttl=3600 rotate=0 same_site=Lax"`.

### Cross-module: authz session_gate

The authz module provides its own `session_gate` handler that composes session store and cookie logic. This lets you use authz as the sole js_import while still gating on sessions.

```nginx
http {
    js_shared_dict_zone zone=sessions:1m timeout=1h;
    js_import authz_main from authz.js;

    server {
        listen 8888;

        set $session_dict sessions;

        location /api/ {
            auth_request /auth;
            auth_request_set $session_subject $upstream_http_x_session_subject;
            proxy_pass http://backend;
        }

        location /auth {
            internal;
            set $session_dict sessions;
            js_content authz_main.session_gate;
        }
    }
}
```

### Cross-module: feature_flags session key type

Feature flags can use session identity as the bucket key for stable per-user rollout. Falls back to request key when no session is present.

```nginx
http {
    js_shared_dict_zone zone=sessions:1m timeout=1h;
    js_import main from feature_flags.js;
    js_import session_main from session.js;

    server {
        listen 8888;

        set $session_dict sessions;
        set $session_ttl 3600;

        location /start {
            set $session_subject $arg_subject;
            js_content session_main.start;
        }

        location /evaluate {
            set $ff_key_type session;
            set $ff_key fallback-42;
            set $ff_name               "dark_mode";
            set $ff_dark_mode_enabled  "1";
            set $ff_dark_mode_pct      "50";
            js_content main.evaluate;
        }
    }
}
```

## Public Gleam API

The module source lives in `modules/session/src/`. All handlers are registered through a single `exports()` function.

### `nginz_njs_session.exports()` (the nginx adapter)

Returns a JavaScript object mapping handler names to functions for `js_import`.

Exported handlers:

| Handler        | Type              | Behavior |
|----------------|-------------------|----------|
| `describe`     | sync              | Returns a summary of the default session descriptor. |
| `start`        | async (Promise)   | Creates a session. Reads `$session_subject`, `$session_dict`, `$session_ttl`. Generates SHA-256 session ID. Returns 204 + Set-Cookie. |
| `start_oidc`   | async (Promise)   | Creates a session from OIDC subject. Reads `$session_oidc_sub` (preferred) or `$oidc_claim_sub`. Normalizes to `"oidc:{sub}"`. Returns 204 + Set-Cookie, or 401. |
| `verify`       | sync              | Reads session cookie, looks up subject in shared dict. Returns 204 + `X-Session-Subject`, or 401. |
| `end_session`  | sync              | Deletes session and canary assignment, clears client cookie. Always returns 204. |
| `get_canary`   | sync              | Reads sticky canary assignment. Returns `"1"` or `"0"`, or 404 when unset. |
| `set_canary`   | sync              | Stores canary assignment from `$session_canary` (must be `"1"` or `"0"`). Returns 204, or 400 on invalid input. |

### `session/model`

Core types for session configuration.

**Types:**

- `CookieConfig(name, http_only, secure, path, same_site)` -- cookie boundary configuration
- `StoreBackend` -- `SharedDict` or `RedisFallback`
- `SessionDescriptor(cookie, backend, ttl_seconds, rotate_after_seconds)` -- the session contract
- `DescriptorError` -- `TtlNotPositive` | `RotateNegative`

**Functions:**

- `default_descriptor()` -- `SharedDict`, ttl=3600s, rotate=0, cookie name `"sid"`, SameSite=Lax, HttpOnly
- `validate(descriptor)` -- `Ok(descriptor)` or `Error(DescriptorError)`
- `summary(descriptor)` -- human-readable string for logging or inspection

**CookieConfig fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | Cookie name (e.g. `"sid"`) |
| `http_only` | Bool | Set HttpOnly attribute |
| `secure` | Bool | Set Secure attribute |
| `path` | String | Cookie path scope |
| `same_site` | String | SameSite value: `"Lax"`, `"Strict"`, `"None"` |

### `session/cookie`

- `set_header(config, session_id, ttl_s)` -- builds a `Set-Cookie` header value
- `clear_header(config)` -- builds a `Max-Age=0` expiry header
- `read_id(cookie_header, name)` -- extracts the named session ID from a `Cookie` request header

### `session/store`

- `load(dict_name, session_id)` -- returns the subject string or `Error(Nil)` on miss or expiry
- `save(dict_name, session_id, subject, ttl_s)` -- persists session with TTL
- `delete(dict_name, session_id)` -- invalidates a session; silent no-op on miss

### `session/assignment`

Sticky rollout assignment persistence alongside sessions.

- `CanaryAssignment` -- `Assigned(Bool)` | `Unassigned`
- `canary_to_string(Bool)` -- serializes `True` to `"1"`, `False` to `"0"`
- `canary_from_string(raw)` -- parses `"1"` / `"0"` to `Assigned`, else `Unassigned`
- `parse_canary_input(raw)` -- validates and parses `"1"` or `"0"` to a Bool; returns `Error(Nil)` on other values
- `load_canary(dict, sid)` -- reads sticky canary from `{sid}:canary` key
- `save_canary(dict, sid, Bool, ttl_s)` -- persists sticky assignment
- `delete_canary(dict, sid)` -- removes canary key on session end

### `session/identity`

- `from_oidc_sub(sub)` -- normalizes OIDC subject as `"oidc:{sub}"`; `Error` on empty
- `to_oidc_sub(subject)` -- strips the `"oidc:"` prefix; `Error` when not OIDC-prefixed

### `session/metrics`

- `start()` -- counter metric for successful session creation
- `verify(success)` -- counter metric for verification success or failure
- `end_session()` -- counter metric for session invalidation

## Works well with

- [Authz](/docs/reference/scripted-modules/authz) for session-backed access control via `session_gate` and policy trees that consume session identity.
- [Feature Flags](/docs/reference/scripted-modules/feature-flags) for session-backed bucket key resolution and sticky rollout assignment.
- [OpenID Connect](/docs/reference/modules/oidc) when OIDC-backed sessions are started from native OIDC claims.
- [JWT Authentication](/docs/reference/modules/jwt) for token-based authentication that feeds verified claims into session start.
- [NJS Orchestration](/docs/reference/modules/njs) for custom orchestration that reads or creates sessions via subrequest.
