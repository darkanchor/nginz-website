---
title: Canary Routing
description: Gradually send traffic to a new version by percentage or by explicit request header.
---

# Canary Routing

Use this module when you want to roll out a new backend safely instead of switching all traffic at once.

## When to use this module

- You want to release a new version to 5%, 10%, or 50% of traffic first.
- You need developers or testers to force traffic to the new version with a header.
- You want a simple A/B or canary policy at the proxy layer.
- You need one reusable canary decision that other nginx directives can consume.

## nginx.conf synthesis

Use the module to set `$ngz_canary`, then map that value to the right upstream.

```nginx
upstream stable { server 10.0.0.1:8080; }
upstream canary { server 10.0.1.1:8080; }

map $ngz_canary $backend {
    "1" canary;
    default stable;
}

location /api {
    canary_percentage 10;
    canary_header X-Canary true;
    proxy_pass http://$backend;
}
```

This gives you a header override for explicit testing, with percentage rollout as the fallback.

## Directive reference

### `canary_percentage`

- **Contexts:** `location`
- **Default:** `0`

Sets what portion of requests should go to the canary path. Use this for gradual rollout and change the percentage over time as confidence grows.

### `canary_header`

- **Contexts:** `location`
- **Default:** none

Defines a request header and value that force canary routing when they match. This takes priority over percentage-based routing and is useful for controlled testing.

## Works well with

- **Upstream Balancer** when the canary backend itself needs sticky behavior.
- **Request ID** for tracing whether a request hit stable or canary.
- **Prometheus Metrics** for watching the rollout effect on latency and error rate.
