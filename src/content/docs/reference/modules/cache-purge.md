---
title: Cache Purge API
description: Expose a safe operator-facing endpoint for targeted cache invalidation by exact or prefix match.
---

# Cache Purge API

Use this module when you need a controlled way to invalidate cached content without clearing everything.

## When to use this module

- You want an internal purge endpoint for apps, admin tools, or deployment automation.
- You tag or index cached objects and need to remove only the affected entries.
- You want stricter authorization and better operational controls than a raw PURGE pattern.
- You need purge behavior that works across multiple workers.

## nginx.conf synthesis

Put the purge API on a protected internal location and bind it to the cache metadata zone.

```nginx
location /internal/cache-purge {
    cache_purge_api;
    cache_purge_zone default;
    cache_purge_match exact;
    cache_purge_authorize allowlist;
    cache_purge_allowlist 127.0.0.1/32 ::1/128;
    cache_purge_max_keys 256;
}
```

This creates a JSON purge endpoint that accepts operator requests and applies invalidation against the shared metadata store.

## Directive reference

### `cache_purge_api`

- **Contexts:** `location`
- **Default:** disabled

Turns the location into the purge endpoint. Use it only on an explicitly internal or tightly controlled route.

### `cache_purge_zone`

- **Contexts:** `location`
- **Default:** `default` / `cache_tags_zone` depending on configuration

Selects which purge metadata zone the endpoint uses. In practice this binds purge operations to the metadata produced by cache tagging.

### `cache_purge_match`

- **Contexts:** `location`
- **Default:** implementation-defined exact path

Chooses how targets are matched. `exact` is cheapest and safest; `prefix` is broader and more expensive; `glob` is intentionally deferred.

### `cache_purge_authorize`

- **Contexts:** `location`
- **Default:** off

Defines how callers are authorized. Today the practical customer choice is whether the endpoint is open or limited by allowlist.

### `cache_purge_allowlist`

- **Contexts:** `location`
- **Default:** none

Lists the IPs or CIDR ranges allowed to call the purge endpoint when allowlist authorization is enabled. Use it to keep purge power inside trusted infrastructure.

### `cache_purge_max_keys`

- **Contexts:** `location`
- **Default:** bounded by implementation

Limits how many purge targets can be requested in one call. This protects the endpoint from oversized invalidation requests.

### `cache_purge_worker_events_mode`

- **Contexts:** `location`
- **Default:** `per_target`

Controls whether successful purges emit no events, one event per target, or a batch summary. Use `summary` or `off` if event volume matters more than per-target detail.

### `cache_purge_worker_events_channel`

- **Contexts:** `location`
- **Default:** none

Names the worker-events channel used for purge notifications. Set it when another module or consumer needs to react to invalidation.

## Works well with

- Stock nginx `proxy_cache_purge` — use the standard purge directive for simple URL-based invalidation; cache-purge adds tag, prefix, and operator auth controls.
- **Cache Tags** because tags create the metadata this module invalidates.
- **Worker Events** when you need purge notifications across workers.
- **Prometheus Metrics** if you want purge traffic and purge outcomes visible in monitoring.
