---
title: Cache Tags
description: Attach tags to cached responses so later purge operations can invalidate related content together.
---

# Cache Tags

Use this module when you want to expire groups of cached objects by meaning instead of by raw cache key.

## When to use this module

- You cache application responses and want to purge by entity or content group.
- You need one article update to invalidate every related cached page.
- You want simple tag-driven invalidation without adding Redis just for cache control metadata.
- You want cache metadata shared across workers.

## nginx.conf synthesis

Enable tag capture on the cached route and expose a purge route only if you want the simple built-in purge behavior.

```nginx
server {
    location /api {
        proxy_pass http://backend;
        cache_tags;
    }

    location /cache/purge {
        cache_tags_purge;
        allow 127.0.0.1;
        deny all;
    }
}
```

Your upstream should emit a `Cache-Tag` header such as `user-123, product-456` so the module can store the mapping.

## Directive reference

### `cache_tags`

- **Contexts:** `location`
- **Default:** disabled

Enables tag collection for responses in that location. The module reads the upstream `Cache-Tag` header and stores the tag-to-URI mapping in shared memory.

### `cache_tags_purge`

- **Contexts:** `location`
- **Default:** disabled

Turns the location into a simple purge endpoint for exact-tag invalidation. It is useful for straightforward workflows, but it is intentionally simpler than the dedicated cache-purge module.

## Works well with

- Stock nginx `proxy_cache` and `proxy_cache_key` — cache responses with standard nginx caching; cache-tags adds grouped invalidation on top.
- **Cache Purge API** when you want the richer operational purge surface.
- **Worker Events** if you want invalidation signals fanned out to other consumers.
- **Transform** when you cache API responses but still want shaped output for clients.
