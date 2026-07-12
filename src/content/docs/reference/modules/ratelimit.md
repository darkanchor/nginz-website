---
title: Rate Limiting
description: Fixed-window rate limiting with per-IP defaults and variable-driven inputs for cost, key, and skip signals.
---

# Rate Limiting

Use this module when you need to protect upstream services by limiting request rates at the nginx layer.

## When to use this module

- You want to cap requests per second by client IP.
- You need burst allowance so legitimate traffic spikes are not rejected.
- You want to vary the rate limit cost by request (e.g., expensive endpoints cost more tokens).
- You need to skip rate limiting for trusted or internal traffic.
- You want the rate limit decision and budget visible in logs or response headers.

## nginx.conf synthesis

Rate limiting is configured per location. Basic usage just needs a rate:

```nginx
location /api {
    ratelimit_rate 10r/s;
    proxy_pass http://backend;
}
```

Add burst to smooth out short traffic spikes:

```nginx
location /api/heavy {
    ratelimit_rate 5r/s;
    ratelimit_burst 10;
    proxy_pass http://backend;
}
```

Use variables to control cost, key, and skip dynamically:

```nginx
location /expensive {
    set $rl_cost 3;
    set $rl_skip 0;

    ratelimit_rate 10r/s;
    ratelimit_cost $rl_cost;
    ratelimit_skip $rl_skip;

    add_header X-Ratelimit-Result $ratelimit_result always;
    add_header X-Ratelimit-Key $ratelimit_key always;

    proxy_pass http://backend;
}
```

## Directive reference

### `ratelimit_rate`

- **Contexts:** `location`
- **Default:** none

Sets the rate limit in requests per second. Accepts `10r/s` or plain `10` syntax.

### `ratelimit_burst`

- **Contexts:** `location`
- **Default:** `0`

Allows additional burst requests beyond the base rate. Requests within the burst window are not rejected.

### `ratelimit_key`

- **Contexts:** `location`
- **Default:** client IP address

Overrides the identity used for rate-limit accounting. Set this to a variable to key on a customer ID, API key, or any request attribute instead of the client IP.

### `ratelimit_cost`

- **Contexts:** `location`
- **Default:** `1`

Controls how many tokens a single request consumes. The variable should resolve to an integer. Invalid or missing values fall back to `1`.

### `ratelimit_skip`

- **Contexts:** `location`
- **Default:** disabled

Bypasses rate limit enforcement when the variable resolves to a truthy value (`1`, `true`, `yes`, `on`). Use this when an earlier access module signals a trusted request.

## Variables

The module exports these nginx variables for observability:

| Variable | Description |
|---|---|
| `$ratelimit_result` | Per-request decision: `allow` or `deny` |
| `$ratelimit_key` | The effective key used for accounting on the current request |
| `$ratelimit_source` | Where the key came from: `ip` or `variable` |
| `$ratelimit_cost` | The effective token cost applied to the current request |
| `$ratelimit_entries` | Number of occupied fixed-window buckets in shared memory (maximum 1024) |
| `$ratelimit_capacity_rejected` | Cumulative new buckets rejected because every stored window is still live |
| `$ratelimit_reclaimed` | Cumulative expired buckets safely reused for new keys |

## Behavior notes

- Uses a 1-second fixed window algorithm. Each key gets a counter that resets every second.
- Returns HTTP 429 (Too Many Requests) when the limit is exceeded.
- Rate state is stored in nginx shared memory, so the same budget is enforced across all workers.
- Up to 1024 unique keys are tracked in the shared zone. Expired buckets may be reused; if all buckets are still live, a new key is rejected rather than evicting another client's enforcement state.
- Runs in the access phase. Earlier modules that return a final status (401, 403, 429) will prevent the rate limit decision from running.
- Counters are location-scoped. Changing `ratelimit_key` changes identity within that location, not across unrelated locations.

## Works well with

- Stock nginx `limit_req` and `limit_conn` — these handle request and connection limits; ratelimit adds variable-driven keys, cost weighting, and shared-memory counters.
- [Request ID](/docs/reference/modules/requestid) for correlating rate-limited requests across logs.
- [JWT Authentication](/docs/reference/modules/jwt) or [OpenID Connect](/docs/reference/modules/oidc) when you want to rate limit by authenticated identity rather than IP address.
- [Circuit Breaker](/docs/reference/modules/circuit-breaker) for a second layer of protection when rate limits are not enough.
