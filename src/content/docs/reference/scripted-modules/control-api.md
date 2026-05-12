---
title: Control API
description: Operator-facing control surface for runtime inspection, health, feature flag management, cache and session probes, and shared metric rendering.
---

# Control API

Use this module when your gateway has grown beyond static config and operators need to inspect and adjust behavior without editing a file and reloading nginx. It creates one coherent operator-facing surface for listing control routes, reading state, and performing small trusted control actions against runtime-backed modules.

## When to use this module

- You want a runtime route inventory and health endpoint to confirm which control capabilities are loaded.
- You need to inspect and toggle feature flag state through an HTTP API rather than config reloads.
- You want to verify shared-dict reachability for `mlcache` and session backends from a single probe endpoint.
- You need to render or describe metrics through the operator surface without writing a separate handler.
- You are building CI/CD or internal tooling that drives the gateway at runtime and want a stable, JSON-first control contract.

## nginx.conf synthesis

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        # Route inventory and capability summary
        location /runtime/describe {
            js_content main.describe;
        }

        # Runtime health and readiness
        location /runtime/health {
            js_content main.health;
        }

        # Module and version info
        location /runtime/system {
            js_content main.system_info;
        }

        # Inspect a feature flag by name (?name=...)
        location /runtime/flag {
            js_content main.inspect_flag;
        }

        # Toggle a feature flag (?name=...&enabled=true&rollout_pct=100&ttl_s=3600)
        location /runtime/flag/set {
            js_content main.toggle_flag;
        }

        # Cache shared-dict reachability probe (?dict=...)
        location /runtime/cache/probe {
            js_content main.probe_cache;
        }

        # Session shared-dict reachability probe (?dict=...)
        location /runtime/session/probe {
            js_content main.probe_session;
        }

        # Render a StatsD metric line from query params
        location /runtime/metrics/render {
            js_content main.render_metric;
        }

        # Describe a metric from query params
        location /runtime/metrics/describe {
            js_content main.describe_metric;
        }
    }
}
```

In production, this surface should be internal-only, protected by network policy, mTLS, or an `auth_request` / `authz` gate. The module exposes operational actions but does not decide who is allowed to use them. That belongs to nginx config and authorization policy.

## Public Gleam API

### Endpoint model (`control_api/model`)

| Type | Description |
|---|---|
| `Endpoint` | Named runtime endpoint descriptor |
| `endpoints()` | Stable route inventory for the current runtime surface |
| `summary()` / `describe_all()` | Human-readable endpoint summaries |

### Response helpers (`control_api/response`)

| Function | Description |
|---|---|
| `json_object(Dict(String,String))` | Flat JSON object rendering |
| `json_ok(Dict(String,String))` | Stable ok envelope for operational responses |
| `json_error(String)` | Stable error envelope for validation and runtime failures |

### Flag management (`control_api/flag`)

| Function | Description |
|---|---|
| `inspect(String, String)` | Read runtime-backed feature flag state from a named shared dict |
| `toggle(String, String, Bool, Int, Int)` | Write flag state (enabled, rollout percentage, TTL) to a shared dict |

### Probing (`control_api/probe`, `control_api/session_probe`)

| Function | Description |
|---|---|
| `system_info()` | Basic module, version, and timestamp surface |
| `cache_probe(String)` | Shared-dict reachability probe via `mlcache/shared` |
| `session_probe(String)` | Shared-dict reachability probe via `session/store` |

### Metric rendering (`control_api/metrics_handler`)

| Function | Description |
|---|---|
| `render_metric(...)` | Build and render a StatsD line from query params; returns 400 with error details on malformed input |
| `describe_metric(...)` | Build and describe a metric; returns 400 with error details on malformed input |

### HTTP contract

| Endpoint | Returns |
|---|---|
| `GET /runtime/describe` | Plain-text route inventory |
| `GET /runtime/health` | `200` JSON |
| `GET /runtime/system` | `200` JSON with module, version, timestamp |
| `GET /runtime/flag?name=...` | `200` JSON ok or error payload |
| `GET /runtime/flag/set?name=...&enabled=...` | `200` JSON describing written flag state |
| `GET /runtime/cache|session/probe?dict=...` | `200` JSON or `400` on missing params |
| `GET /runtime/metrics/render?...` | Plain-text StatsD line or `400` on malformed params |
| `GET /runtime/metrics/describe?...` | Plain-text metric summary or `400` on malformed params |

## Works well with

- Stock nginx `allow` and `deny` — protect the control API surface with IP-level access control.
- [Feature Flags](/docs/reference/scripted-modules/feature-flags) for runtime-backed flag state inspection and mutation.
- [MLCache](/docs/reference/scripted-modules/mlcache) for shared-dict reachability probes and cache inspection.
- [Session](/docs/reference/scripted-modules/session) for session store reachability probes.
- [Metrics](/docs/reference/scripted-modules/metrics) for shared metric render and describe surfaces.
- [Request Tracing](/docs/reference/scripted-modules/request-tracing) for trace summary and debug surfaces.
- [AuthZ](/docs/reference/scripted-modules/authz) for protecting the runtime API surface with consistent access policy.
