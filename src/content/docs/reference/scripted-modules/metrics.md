---
title: Metrics
description: Shared metrics modeling and StatsD/DogStatsD line rendering that other scripted modules emit into, rather than each module formatting protocol strings on its own.
---

# Metrics

Use this module when you want modules to speak the same operational language. Instead of each module inventing its own metric names, tags, and output format, this module gives the entire ecosystem one shared way to describe and render metrics.

## When to use this module

- You want a consistent metrics vocabulary across `http_client`, `authz`, `feature_flags`, `session`, `mlcache`, `response_transform`, `workflow`, and `webhook`.
- You need StatsD or DogStatsD formatted metric lines for ingestion by your observability pipeline.
- You want typed validation of metric names, tags, sample rates, and counter values at construction time rather than discovering issues at query time.
- You are building a module that needs to emit operational signals and do not want to write yet another StatsD string formatter.

## nginx.conf synthesis

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        # Describe the demo metric
        location /describe {
            js_content main.describe;
        }

        # Render a StatsD line from query parameters
        location /emit/statsd {
            js_content main.emit_statsd;
        }

        # Render a DogStatsD line from query parameters
        location /emit/dogstatsd {
            js_content main.emit_dogstatsd;
        }

        # Validate a metric definition from query parameters
        location /validate {
            js_content main.validate_metric;
        }

        # Render using a named helper pattern (increment, error, timing)
        location /emit/helper {
            js_content main.emit_helper;
        }
    }
}
```

These handlers are primarily for testing and integration verification. In production, other modules import `metrics/helpers` directly in Gleam code and construct `Metric` values as part of their normal request processing, then pass those values to a sink adapter.

## Public Gleam API

### Core metric model (`metrics/line`)

| Type | Description |
|---|---|
| `Metric` | Instrumentation value with `name`, `value`, `metric_type`, `tags`, `sample_rate`, `namespace` |
| `MetricType` | `Counter`, `Gauge`, `Timing`, `Set`, `Distribution` |
| `Tag` | `name:value` pair for downstream sinks |
| `Format` | `StatsD` or `DogStatsD` |
| `MetricError` | Typed validation errors: `EmptyName`, `NegativeCounterValue`, `InvalidSampleRate`, `EmptyTagName`, and more |

| Function | Description |
|---|---|
| `validate(Metric)` | Validates name, tags, counter non-negativity, sample rate range |
| `render_statsd(Metric)` | StatsD line: `<ns>.<name>:<value>\|<type>[\|@<rate>]\|#<tags>` |
| `render_dogstatsd(Metric)` | DogStatsD format (identical for standard metric types) |
| `render(Metric, Format)` | Dispatch by format |
| `describe(Metric)` | Human-readable summary |
| `demo_metric()` | Example metric for scaffold testing |

### Reusable constructors (`metrics/helpers`)

| Function | Description |
|---|---|
| `counter(name, value, tags)` | Counter metric |
| `gauge(name, value, tags)` | Gauge metric |
| `timing(name, value_ms, tags)` | Timing metric in milliseconds |
| `distribution(name, value, tags)` | DogStatsD distribution |
| `set(name, value, tags)` | Set metric |
| `increment(name, tags)` | Counter +1 shorthand |
| `latency(name, ms, tags)` | Timing alias |
| `error_event(name, tags)` | Error counter +1, auto-tagged with `error:true` |

### Tag constructors

`tag_service(name)`, `tag_status(code)`, `tag_route(path)`, `tag_method(verb)`, `tag_result(outcome)`

### Usage pattern for module authors

```gleam
import metrics/helpers

let success = helpers.increment("http_requests_total", [
  helpers.tag_route("/api/users"),
  helpers.tag_status(200),
])

let error = helpers.error_event("upstream_failure", [
  helpers.tag_route("/api/users"),
  helpers.tag_status(502),
])

let latency = helpers.latency("upstream_duration_ms", 42, [
  helpers.tag_route("/api/users"),
])
```

Sink transport (StatsD UDP, log emission, or another delivery mechanism) is a separate concern that consumes `Metric` values from the pure model layer.

## Works well with

- [HTTP Client](/docs/reference/scripted-modules/http-client) for request outcome and latency metrics.
- [AuthZ](/docs/reference/scripted-modules/authz) for decision and external call metrics.
- [Response Transform](/docs/reference/scripted-modules/response-transform) for transform and pass-through counters.
- [Request Tracing](/docs/reference/scripted-modules/request-tracing) for trace latency and request counters.
- [Feature Flags](/docs/reference/scripted-modules/feature-flags) for evaluation and bucketing metrics.
- [Session](/docs/reference/scripted-modules/session) for lifecycle event metrics.
- [MLCache](/docs/reference/scripted-modules/mlcache) for hit, miss, and stampede counters.
- [Control API](/docs/reference/scripted-modules/control-api) for rendering and describing shared metrics through the operator surface.
