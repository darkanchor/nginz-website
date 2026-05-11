---
title: Request Tracing
description: Distributed tracing glue that reads the native request ID, propagates trace headers to upstreams, records workflow spans, and emits structured trace logs.
---

# Request Tracing

Use this module when debugging across request boundaries has become guesswork. It gives each request a trace identity that travels with it, making it much easier to connect the pieces across nginx, upstream services, and logs.

## When to use this module

- You need to propagate `X-Request-ID` and `X-Trace-ID` headers to upstream services so backend systems can correlate with the edge.
- You want to record timed spans for workflow steps and emit structured trace output in JSON or logfmt format.
- You are composing `workflow` parallel fan-out and need automatic span recording for each subrequest step.
- You have the native `requestid` module loaded and want to read `$ngz_request_id` as the trace root.
- You want to emit trace latency metrics and request counters through the shared `metrics` module.

## nginx.conf synthesis

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        # Header propagation only
        location /api/ {
            js_content main.traced;
        }

        # Header propagation + structured JSON trace log
        location /log/ {
            js_content main.traced_with_log;
        }

        # Header propagation with session correlation
        location /correlated/ {
            js_content main.traced_with_session;
        }

        # Workflow with span recording
        location /workflow/ {
            js_content main.traced_workflow;
        }

        # Enrichment workflow with trace metrics
        location /enrich/ {
            js_content main.traced_enrich;
        }
    }
}
```

The module reads `$ngz_request_id` from the native `requestid` module, falls back to `$request_id`, then to `"unknown"`. The native module runs in the ACCESS phase and owns hot-path ID generation; this module runs in the CONTENT phase and owns propagation, span recording, and structured emission.

## Public Gleam API

### Trace model (`request_tracing/model`)

| Type | Description |
|---|---|
| `TraceContext` | Accumulating trace state with `request_id`, `start_time`, `spans` |
| `Span` | A single timed operation: `name`, `duration_ms`, `status`, `success` |

| Function | Description |
|---|---|
| `context(String)` | Build a new TraceContext from a request ID |
| `add_span(TraceContext, Span)` | Append a span to the context |
| `total_duration(TraceContext)` | Sum of all span durations |
| `summary(TraceContext)` | Human-readable trace summary |

### Header propagation (`request_tracing/propagate`)

| Function | Description |
|---|---|
| `propagation_headers(TraceContext)` | Returns `X-Request-ID` and `X-Trace-ID` header pairs for upstream injection |
| `inject_upstream(TraceContext)` | Alias for use with `proxy_set_header` patterns |

### Trace emission (`request_tracing/emit`)

| Function | Description |
|---|---|
| `json(TraceContext, Float)` | JSON trace line with `trace_id`, `duration_ms`, `span_count`, `spans` |
| `logfmt(TraceContext, Float)` | Logfmt trace line with span success/failure breakdown |

### Span recording (`request_tracing/record`)

| Function | Description |
|---|---|
| `record_span(TraceContext, String, Int, Int)` | Pipe-friendly span accumulator |
| `record_result(TraceContext, String, Int, Int)` | Record a span from an observed step outcome |
| `record_step_results(TraceContext, Float, Float, List(#(String, Result))` | Record workflow step outcomes as spans |
| `trace_run_parallel(TraceContext, r, List(#(String, String)))` | Reusable recipe that wraps `workflow/pipeline.run_parallel` with named span recording |

### Trace metrics (`request_tracing/metrics`)

| Function | Description |
|---|---|
| `latency_metric(TraceContext, Int, String)` | Histogram-style latency metric for the trace |
| `traced_counter(TraceContext, String)` | Traced request counter |

## Works well with

- [Request ID](/docs/reference/modules/requestid) (native) for `$ngz_request_id` UUIDv4 generation per request.
- [Workflow](/docs/reference/scripted-modules/workflow) for span recording during subrequest orchestration.
- [HTTP Client](/docs/reference/scripted-modules/http-client) for injecting trace headers into upstream fetch calls.
- [Metrics](/docs/reference/scripted-modules/metrics) for emitting trace latency and request counters through StatsD.
- [Session](/docs/reference/scripted-modules/session) for correlating trace context with session identity.
- [Control API](/docs/reference/scripted-modules/control-api) for surfacing trace summaries through runtime inspection.
