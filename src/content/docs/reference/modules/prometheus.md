---
title: Prometheus Metrics
description: Export native nginz metrics in Prometheus exposition format including request counters, status code class breakdown, and latency histograms.
---

# Prometheus Metrics

Use this module when you want to collect standard HTTP metrics from nginz and scrape them into your Prometheus or OpenTelemetry monitoring stack. It runs entirely inside nginx with no external exporter process.

## When to use this module

- You monitor nginx with Prometheus and want native metrics without running a separate exporter.
- You need request volume, error rate, and latency data at the nginx layer.
- You want cross-worker metric aggregation via shared memory so every scrape reflects all workers.
- You need to expose metrics as nginx variables for scripted policy decisions (load-aware routing, circuit breaking).

## nginx.conf synthesis

```nginx
http {
    server {
        listen 8080;

        location / {
            proxy_pass http://backend;
        }

        location /metrics {
            prometheus_metrics;

            # Restrict to monitoring infrastructure
            allow 10.0.0.0/8;
            allow 127.0.0.1;
            deny all;
        }
    }
}
```

Metrics are stored in shared memory so the `/metrics` endpoint aggregates data from all nginx workers. Requests to the `/metrics` location are not counted.

## Exported metrics

```
# HELP nginx_up Whether nginx is up
# TYPE nginx_up gauge
nginx_up 1

# HELP nginx_http_requests_total Total number of HTTP requests
# TYPE nginx_http_requests_total counter
nginx_http_requests_total 12345

# HELP nginx_http_requests_by_status HTTP requests by status code class
# TYPE nginx_http_requests_by_status counter
nginx_http_requests_by_status{status="2xx"} 10000
nginx_http_requests_by_status{status="4xx"} 800
nginx_http_requests_by_status{status="5xx"} 45

# HELP nginx_http_request_duration_seconds Request duration in seconds
# TYPE nginx_http_request_duration_seconds histogram
nginx_http_request_duration_seconds_bucket{le="0.005"} 5000
nginx_http_request_duration_seconds_bucket{le="0.01"} 7500
nginx_http_request_duration_seconds_bucket{le="+Inf"} 12345
nginx_http_request_duration_seconds_sum 125.432
nginx_http_request_duration_seconds_count 12345
```

Default histogram buckets: 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s, +Inf.

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: 'nginz'
    static_configs:
      - targets: ['nginx-server:8080']
    metrics_path: '/metrics'
```

## Nginx variables for scripted consumers

These variables read from the same shared-memory counters with no extra cost:

| Variable | What it gives you |
|----------|-------------------|
| `$prometheus_requests_total` | Total request count (excluding self-scrapes) |
| `$prometheus_error_rate` | Error rate as decimal 0.0-1.0 (4xx+5xx) / total |

Use them in njs handlers or config-level policy for load-aware routing or circuit breaker decisions.

## Directive reference

### `prometheus_metrics`

- **Contexts:** `location`
- **Default:** none

Enables the Prometheus metrics endpoint at this location. Returns metrics in Prometheus text exposition format.

## Limitations

- Metrics reset when nginx is fully restarted (shared memory is recreated). Graceful reloads preserve counters.
- Custom metric labels are not yet supported.
- Connection-level metrics (active connections, accepted) are not yet exported.

## Works well with

- Stock nginx stub_status — the built-in status page gives basic connection and request counts; Prometheus metrics adds histograms, per-status breakdowns, and shared-memory aggregation.
- [Circuit Breaker](/docs/reference/modules/circuit-breaker) for feeding error rate data into circuit-breaker decisions.
- [NJS Orchestration](/docs/reference/modules/njs) for reading variables and making load-aware routing choices.
- [Consul](/docs/reference/modules/consul) for health-status-aware scrape target registration.
