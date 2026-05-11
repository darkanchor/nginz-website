---
title: Health Checks
description: Active and passive health and readiness endpoints for nginx with shared-memory aggregation, HTTP/HTTPS probing, match rules, slow-start recovery, and Prometheus metrics.
---

# Health Checks

Use this module when you need nginx to actively probe backends, report readiness, and surface health metrics without relying on a separate monitoring system.

## When to use this module

- You need a consistent readiness answer across all nginx workers, not a per-worker guess.
- You want active HTTP or HTTPS probes with configurable thresholds to detect backend failures.
- You want Prometheus-format metrics for health state in your monitoring stack.
- You need your upstream balancer to exclude unhealthy or recovering peers from traffic.
- You want per-upstream and per-peer probe visibility alongside service-level health.

## nginx.conf synthesis

Put the health and readiness endpoints on internal locations. Configure service-level probes and, when needed, per-upstream and per-peer probes.

```nginx
http {
    # Service-level probe targeting the app health endpoint
    location /healthz {
        health_liveness;
    }

    location /ready {
        health_readiness;
        health_probe http://127.0.0.1:8080/health;
        health_probe_interval 3000ms;
        health_probe_timeout 1000ms;
        health_probe_fails 3;
        health_probe_passes 2;
    }

    location /health {
        health_status;
    }

    location /metrics {
        health_metrics;
    }
}
```

For per-upstream probes that feed peer eligibility into the balancer:

```nginx
upstream backend {
    server 10.0.0.11:8080;
    server 10.0.0.12:8080;

    health_upstream_probe http://10.0.0.11:8080/health;
    health_upstream_probe_interval 5000ms;
    health_upstream_probe_fails 2;
    health_upstream_probe_passes 1;
    health_upstream_probe_slow_start 30s;
}
```

This configuration probes each upstream, tracks health at the peer level, and lets the upstream balancer exclude unhealthy or slow-starting peers from selection.

## Directive reference

### `health_status`

- **Contexts:** `location`
- **Default:** disabled

Enables the `/health` JSON endpoint. It reports service-level, per-upstream, and per-peer probe state in a single response.

### `health_liveness`

- **Contexts:** `location`
- **Default:** disabled

Enables the `/healthz` liveness endpoint. Always returns 200 when nginx is alive, regardless of probe state.

### `health_readiness`

- **Contexts:** `location`
- **Default:** disabled

Enables the `/ready` readiness endpoint. Returns 200 when the service-level probe passes and 503 when it fails.

### `health_metrics`

- **Contexts:** `location`
- **Default:** disabled

Enables a Prometheus-format metrics endpoint that exports probe state, health transitions, and counters.

### `health_probe`

- **Contexts:** `location`
- **Default:** none

Sets the service-level probe target URL. Format is `http[s]://host:port/path`.

### `health_probe_interval`

- **Contexts:** `location`
- **Default:** `5000ms`

How often the active probe fires. Lower values detect failure faster but increase probe traffic.

### `health_probe_timeout`

- **Contexts:** `location`
- **Default:** `1000ms`

Socket-level timeout for the probe connect, send, and receive phases.

### `health_probe_fails`

- **Contexts:** `location`
- **Default:** `2`

Consecutive failures needed before the probe target is marked unhealthy. Prevents flapping from transient errors.

### `health_probe_passes`

- **Contexts:** `location`
- **Default:** `1`

Consecutive successes needed before an unhealthy target is marked healthy again.

### `health_probe_slow_start`

- **Contexts:** `location`
- **Default:** `0` (disabled)

Duration after recovery during which the peer is kept out of balancer rotation. Use this to let a recovering backend warm up before receiving traffic.

### `health_probe_match`

- **Contexts:** `location`
- **Default:** none

Match rules for the probe response. Format: `status=<min>-<max> [body=<str>]`. Only responses matching the rule count as successful.

### `health_worker_events_channel`

- **Contexts:** `location`
- **Default:** none

Publishes service-level probe state transitions to the named channel in the worker-events default zone. Set this when other modules or tooling need to observe health flips.

### `health_upstream_probe`

- **Contexts:** `upstream`
- **Default:** none

Sets a per-upstream probe target. Overrides the service-level probe for this upstream group.

### `health_upstream_probe_interval`

- **Contexts:** `upstream`
- **Default:** `5000ms`

Per-upstream probe interval.

### `health_upstream_probe_timeout`

- **Contexts:** `upstream`
- **Default:** `1000ms`

Per-upstream probe timeout.

### `health_upstream_probe_fails`

- **Contexts:** `upstream`
- **Default:** `2`

Per-upstream fail threshold.

### `health_upstream_probe_passes`

- **Contexts:** `upstream`
- **Default:** `1`

Per-upstream pass threshold.

### `health_upstream_probe_slow_start`

- **Contexts:** `upstream`
- **Default:** `0`

Per-upstream slow-start recovery ramp.

### `health_upstream_probe_match`

- **Contexts:** `upstream`
- **Default:** none

Per-upstream match rules for probe response validation.

### `health_upstream_peer_probe`

- **Contexts:** `upstream`
- **Default:** none

Sets a per-peer probe target. Format: `<addr> <http[s]://host:port/path>`. This directive is repeatable for multiple peers.

## Variables

The module exports these nginx variables for use in logging or scripting:

| Variable | Description |
|---|---|
| `$health_readiness` | Returns `1` if the service-level probe is passing, `0` otherwise |
| `$health_liveness` | Returns `1` when nginx is alive |
| `$health_backend_healthy_count` | Number of backends currently passing their probes |
| `$health_backend_total_count` | Total number of tracked backends |
| `$health_backend_failure_count` | Number of backends currently failing their probes |

## Behavior notes

- Passive request and failure counters exclude the health endpoints themselves.
- Probe results are shared across workers, but only worker 0 performs the periodic probe loops.
- Liveness and readiness are intentionally different. Nginx can be alive while readiness is failing.
- Upstream peer selection consumes probe state through the upstream balancer, which excludes unhealthy peers and peers still inside slow-start recovery.
- If a peer has no probe configured, it is treated as healthy (fail-open semantics).

## Works well with

- [Upstream Balancer](/docs/reference/modules/upstream-balancer) because it excludes unhealthy and slow-starting peers at request time.
- [Worker Events](/docs/reference/modules/worker-events) for publishing health transition notifications across workers.
- [Prometheus Metrics](/docs/reference/modules/prometheus) for scraping health state into monitoring.
