---
title: Upstream Balancer
description: Sticky-session upstream balancer for nginx peer selection with cookie and header affinity, health-aware eligibility, and status observability.
---

# Upstream Balancer

Use this module when requests from the same client need to land on the same backend server consistently.

## When to use this module

- You run session-dependent applications and need sticky routing without external session stores.
- You want cookie-based or header-based affinity without modifying your application code.
- You need a fallback strategy when the sticky target is unavailable.
- You want the balancer to respect healthcheck state and avoid unhealthy or recovering peers.
- You need visibility into sticky decisions, cookie lifecycle, and peer rejection reasons.

## nginx.conf synthesis

Cookie affinity is the most common pattern. The balancer reads a cookie from the request, hashes it, and routes to the same peer consistently.

```nginx
upstream backend {
    upstream_balancer_sticky_cookie route;
    upstream_balancer_fallback next;

    server 10.0.0.11:8080;
    server 10.0.0.12:8080;
}
```

For header-based affinity (useful when a reverse proxy or API gateway sets the routing key):

```nginx
upstream backend {
    upstream_balancer_sticky_header X-User-ID;
    upstream_balancer_fallback next;

    server 10.0.0.11:8080;
    server 10.0.0.12:8080;
}
```

To disable fallback and return 502 when affinity misses:

```nginx
upstream backend {
    upstream_balancer_sticky_cookie session;
    upstream_balancer_fallback off;
    upstream_balancer_issue_cookie on;

    server 10.0.0.11:8080;
    server 10.0.0.12:8080;
}
```

Expose the balancer status endpoint for observability:

```nginx
location /balancer-status {
    upstream_balancer_status;
}
```

## Directive reference

### `upstream_balancer_sticky_cookie`

- **Contexts:** `upstream`
- **Default:** disabled

Enables cookie-based sticky affinity. The argument names the cookie to read for the affinity key. Mutually exclusive with `upstream_balancer_sticky_header` in the same upstream block.

### `upstream_balancer_sticky_header`

- **Contexts:** `upstream`
- **Default:** disabled

Enables header-based sticky affinity. The argument names the request header to read for the affinity key. Mutually exclusive with `upstream_balancer_sticky_cookie` in the same upstream block.

### `upstream_balancer_fallback`

- **Contexts:** `upstream`
- **Default:** `next`

Controls behavior when the affinity key is missing or the sticky target is unavailable. `next` falls back to round-robin selection for that request. `off` returns 502 to the client.

### `upstream_balancer_issue_cookie`

- **Contexts:** `upstream`
- **Default:** `off`

When enabled in cookie mode, the balancer issues a `Set-Cookie` header when the request has no affinity key, and rotates stale cookies onto live peers.

### `upstream_balancer_cookie_attrs`

- **Contexts:** `upstream`
- **Default:** `Path=/; HttpOnly; SameSite=Lax`

Overrides the `Set-Cookie` attribute suffix for issued cookies. Use this to set a custom domain, path, or security policy.

### `upstream_balancer_status`

- **Contexts:** `location`
- **Default:** disabled

Exposes a JSON status endpoint with sticky decision counters, cookie lifecycle metrics, and peer rejection breakdowns.

## Behavior notes

- Affinity uses CRC32-IsoHdlc hashing mapped across the weight of eligible peers.
- Eligible means the peer is not down, not already tried, not over `max_conns`, not inside a `max_fails`/`fail_timeout` window, and not excluded by healthcheck.
- Sticky hashing applies to primary peers only. Backup peers are reached through nginx's normal fallback path.
- Once a sticky peer is selected, connect failures flow through nginx's normal retry path. The next request sees updated failure accounting.
- Cookie-mode affinity cookies use the form `<name>=peer:<address>`. Issued cookies default to `Path=/; HttpOnly; SameSite=Lax`.
- Cookie and header directives in the same upstream block are rejected at config load time.
- The balancer integrates with the healthcheck module through `ngz_healthcheck_is_peer_eligible()`. Unhealthy peers and peers in slow-start recovery are excluded from selection. Unprobed peers are treated as eligible (fail-open).
- When the dynamic-upstreams module drains a peer, the balancer excludes it from new selections.

## Works well with

- Stock nginx `proxy_pass` and `upstream` — the balancer integrates with standard upstream blocks and respects `max_fails`, `fail_timeout`, and `max_conns`.
- [Health Checks](/docs/reference/modules/healthcheck) for excluding unhealthy and recovering peers from sticky selection.
- [Dynamic Upstreams](/docs/reference/modules/dynamic-upstreams) for runtime peer set changes that the balancer consumes at request time.
- [Worker Events](/docs/reference/modules/worker-events) for receiving upstream change notifications.
