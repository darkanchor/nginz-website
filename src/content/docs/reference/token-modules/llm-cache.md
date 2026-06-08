---
title: llm-cache
description: Thin scaffold that reserves the cache-policy namespace. No cache lookup, replay, or storage is implemented in the current module.
---

# llm-cache

`llm-cache` is currently a thin scaffold, not an active cache engine. It exists to reserve the cache-policy namespace and enable the module on a location, but it does not yet implement cache mode selection, TTLs, scope rules, bypass controls, lookup, replay, or storage.

## When to use this module

- You want the `llm_cache` namespace present in config while the stack's cache boundary is still being defined.
- You are documenting or testing module composition and want explicit location-level enablement.
- You are preparing for future cache-policy work that will likely execute on `llm-proxy`'s live request/response path.

## nginx.conf synthesis

Minimal enablement:

```nginx
location /v1 {
    llm_proxy;
    llm_proxy_route openai openai_upstream;
    llm_proxy_default_provider openai;

    llm_cache;

    proxy_pass https://$llm_provider_upstream;
}
```

## Directive reference

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_cache` | `location` | — | Enable the cache module scaffold for this location. |

## Current behavior

- The module only stores an enable flag in location config.
- No cache lookup, replay, or storage path exists yet.
- No cache-specific nginx variables are exported.
- No cache eligibility, TTL, scope, bypass, negative-cache, exact-match, or coalescing directives exist in the current implementation.
- Runtime cache execution, when implemented, is expected to live with `llm-proxy` rather than in a separate intercepting module.

## Behavior notes

- This page intentionally documents the implemented surface only. Earlier draft docs described future cache slices; those are not active module behavior today.
- Semantic caching is not the current implementation target.
- Future cache work should be treated as policy owned by `llm-cache` and live request execution owned by `llm-proxy`.
