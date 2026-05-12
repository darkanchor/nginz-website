---
title: MLCache
description: Two-level in-memory cache for nginx built on js_shared_dict. Provides read-through and stale-while-refresh cache semantics that other modules compose instead of reinventing.
---

# MLCache

Use this module when a scripted module keeps computing or fetching the same answer and you want to cache it across requests. It provides a clean separation between cache mechanics (TTL, staleness, refresh policy, stampede protection) and domain logic (what to cache, how to key it). Other modules import mlcache as a library rather than embedding their own caching.

The module does not own what gets cached or how keys are derived. That stays with the consumer. MLCache owns the rules about freshness, staleness, and shared state.

## When to use this module

- You are writing a scripted module that needs to cache expensive computations or external lookups.
- You want stale-while-refresh semantics: serve a slightly stale answer while fetching a fresh one in the background.
- You need cross-worker caching through nginx's `ngx.shared` dictionary API.
- You want stampede protection so multiple concurrent requests for the same key do not all hit the origin at once.

## nginx.conf synthesis

MLCache handlers are wired via `js_content`. The module provides probe handlers for inspecting and exercising the cache at runtime. The cache backend requires a `js_shared_dict_zone` directive in the `http` block.

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    # Shared dictionary named "my_cache" with 1 MB storage and 1 hour timeout.
    # Required by mlcache/shared for cross-worker state.
    js_shared_dict_zone zone=my_cache:1m timeout=1h;

    server {
        listen 8888;

        # Returns a stable summary of the default cache config
        location /describe {
            js_content main.describe;
        }

        # Runtime probe: store a value in the shared dict
        location /put-entry {
            js_content main.put_entry;
        }

        # Runtime probe: read a value from the shared dict
        location /get-entry {
            js_content main.get_entry;
        }

        # Runtime probe: acquire a per-key write lock
        location /try-lock-entry {
            js_content main.try_lock_entry;
        }

        # Runtime probe: release a per-key lock
        location /release-lock-entry {
            js_content main.release_lock_entry;
        }
    }
}
```

Consuming modules (authz, feature_flags, session) configure their own `js_shared_dict_zone` and call `mlcache/shared.get()` and `mlcache/shared.put()` from their handlers. The cache zone name is a parameter, so multiple modules can use separate dicts or share one.

## Public Gleam API

MLCache is organized as a library for other Gleam modules to import, with a small set of njs entry points for runtime inspection.

### `mlcache/model` — configuration types

- **`CacheConfig`** — a record with four fields:
  - `backend` — `SharedDict` (cross-worker via `ngx.shared`) or `PerWorkerOnly` (in-memory per worker).
  - `refresh_policy` — `RefreshOnMiss` (fetch only on cache miss) or `RefreshStale` (serve stale and refresh in background).
  - `ttl_seconds` — fresh lifetime in seconds. Must be greater than 0.
  - `stale_ttl_seconds` — additional stale window beyond TTL. Must be 0 or greater, and must be greater than 0 when policy is `RefreshStale`.

- `default_config()` — returns a config with `SharedDict` backend, `RefreshOnMiss` policy, 60 second TTL, and no stale window.
- `validate(config)` — returns `Ok(config)` or `Error(ConfigError)` with a specific reason. Rejects `TtlNotPositive`, `StaleTtlNegative`, and `StaleWithNoWindow`.
- `summary(config)` — returns a human-readable string such as `"shared_dict policy=refresh_on_miss ttl=60 stale=0"`.

### `mlcache/lookup` — result classification

- **`LookupResult`** — a sum type with three variants: `Hit(value)`, `Stale(value)`, and `Miss`.
- `should_fetch(result)` — returns `True` for `Miss` only. Use this to decide when to call the origin.
- `should_refresh(result)` — returns `True` for `Miss` and `Stale`. Use this to decide when to kick off a background refresh.
- `can_serve(result, policy)` — returns `True` for `Hit` under any policy, and for `Stale` when the policy is `RefreshStale`.
- `get_value(result)` — extracts the cached value string from `Hit` or `Stale`, returning `Error(Nil)` for `Miss`.

### `mlcache/shared` — ngx.shared adapter

- `get(dict_name, key, config)` — reads from a named `ngx.shared` dictionary. Classifies the result as `Hit`, `Stale`, or `Miss` based on an embedded timestamp written at put time.
- `put(dict_name, key, value, config)` — writes to the shared dictionary with a TTL of `ttl + stale_ttl`. Embeds the fresh expiry timestamp as a prefix in the stored string so that reads can detect staleness without extra metadata.
- `delete(dict_name, key)` — removes a key from the dictionary. Silent no-op if the key does not exist.
- `try_lock(dict_name, key, lock_ttl_ms)` — acquires a per-key write lock using `ngx.shared`'s atomic `add` operation. Returns `True` if the lock was acquired. This prevents cache stampedes by serializing origin fetches. Degrades gracefully: returns `True` when the dict is unavailable so the caller still proceeds.
- `release_lock(dict_name, key)` — releases a previously acquired write lock.

### `mlcache/metrics` — observability helpers

- `lookup_result(result)` — emits a counter metric for hit, stale, and miss outcomes.
- `lock_attempt(acquired)` — emits a counter metric for lock acquisition and contention.

### Stale detection

When `put` stores a value, it embeds the fresh expiry timestamp as a prefix: `"<fresh_expiry_ms>:<value>"`. On `get`, the adapter reads the timestamp and compares it against the current time:

- `now < fresh_expiry` — `Hit`
- `now >= fresh_expiry` and `stale_ttl > 0` — `Stale`
- otherwise — `Miss`

The shared dict's native TTL is set to `ttl + stale_ttl`, so entries are automatically removed after the full stale window.

### Exports (njs entry point)

The main module `nginz_njs_mlcache.gleam` exports these handler functions for `js_content`:

| Export | Description |
|---|---|
| `main.describe` | Returns stable default config summary string |
| `main.put_entry` | Stores a value in a named shared dict |
| `main.get_entry` | Reads a value from a named shared dict |
| `main.try_lock_entry` | Acquires a per-key lock for stampede protection |
| `main.release_lock_entry` | Releases a previously acquired lock |

### Typical usage from a consumer module

```gleam
import mlcache/lookup
import mlcache/model
import mlcache/shared

let cfg = model.CacheConfig(
  backend: model.SharedDict,
  refresh_policy: model.RefreshStale,
  ttl_seconds: 300,
  stale_ttl_seconds: 60,
)

// On each request:
let result = shared.get("my_cache", key, cfg.stale_ttl_seconds)
case lookup.can_serve(result, cfg.refresh_policy) {
  True -> {
    let assert Ok(value) = lookup.get_value(result)
    // Serve cached value
    // Optionally kick off a background refresh if lookup.should_refresh(result)
  }
  False -> {
    let fresh = fetch_from_origin(key)
    shared.put("my_cache", key, fresh, cfg)
    // Serve fresh value
  }
}
```

## Works well with

- Stock nginx `proxy_cache` — use `proxy_cache` for response-level caching and mlcache for in-memory, cross-request data caching inside scripted handlers.
- [Workflow](/docs/reference/scripted-modules/workflow) — wraps workflow steps with `cached_step` and `stale_while_refresh` helpers from `workflow/cache`.
- [HTTP Client](/docs/reference/scripted-modules/http-client) — combine cache lookups with http_client fetch calls to build read-through caching for external APIs.
- [NJS](/docs/reference/modules/njs) — provides the `js_shared_dict` runtime that mlcache uses as its cross-worker backend.
- [Authz](/docs/reference/scripted-modules/authz) — caches OPA authorization decisions keyed by token hash.
- [Feature Flags](/docs/reference/scripted-modules/feature-flags) — stores runtime-toggleable flag configuration in mlcache-backed shared dicts.
- [Session](/docs/reference/scripted-modules/session) — stores session ID to subject mappings with TTL-based expiry.
