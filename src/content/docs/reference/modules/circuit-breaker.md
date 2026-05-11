---
title: Circuit Breaker
description: Fail fast when a backend keeps returning errors, then probe it carefully before letting traffic back in.
---

# Circuit Breaker

Use this module when a broken backend should be isolated quickly instead of dragging the whole service down.

## When to use this module

- You want repeated 5xx failures to stop triggering more upstream pressure.
- You need nginx to short-circuit a bad dependency for a recovery window.
- You want controlled recovery instead of sending full traffic back the moment the timeout ends.
- You need the breaker state visible to monitoring or debug endpoints.

## nginx.conf synthesis

Enable the breaker on the proxied location and set failure, timeout, and recovery thresholds.

```nginx
location /api {
    circuit_breaker_threshold 5;
    circuit_breaker_timeout 30s;
    circuit_breaker_success_threshold 2;
    proxy_pass http://backend;
}
```

This configuration opens the circuit after five failures, waits thirty seconds, then requires two successful test requests before closing again.

## Directive reference

### `circuit_breaker_threshold`

- **Contexts:** `location`
- **Default:** `5`

Defines how many failures are tolerated before the circuit opens. Use a lower value for fragile or expensive backends and a higher value if occasional 5xx responses are normal.

### `circuit_breaker_timeout`

- **Contexts:** `location`
- **Default:** `30s`

Sets how long nginx waits before moving from open to half-open. This is the cooldown period that protects the backend from immediate re-flooding.

### `circuit_breaker_success_threshold`

- **Contexts:** `location`
- **Default:** `2`

Controls how many successful half-open requests are needed before the circuit fully closes. Use it to avoid declaring recovery too early.

## Works well with

- **Health Checks** when you want active probe visibility alongside passive failure handling.
- **Prometheus Metrics** for watching breaker behavior and recovery trends.
- **Dynamic Upstreams** if you also need runtime control of the backend set.
