---
title: Response Transform
description: Plan-based JSON field masking, dropping, renaming, and status-conditional shaping for upstream response bodies.
---

# Response Transform

Use this module when the upstream service gives you the wrong shape for the client. Instead of forcing every upstream to serve every audience perfectly, you can mask, drop, rename, or conditionally change fields right before the client sees them.

## When to use this module

- You need to mask sensitive fields like `user.email` or `user.ssn` before the response reaches the client.
- You need to drop internal fields such as `internal.trace` or `debug.stack` from public API responses.
- You are renaming fields as part of a migration (for example, `user.id` to `user_id`) without changing the upstream contract.
- You want status-conditional transforms, such as dropping a `stack_trace` field on 404 responses but keeping it on 500.
- You need a testable, declarative transform plan that does not depend on nginx to validate.

## nginx.conf synthesis

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        location /api/ {
            # Clear Content-Length before body changes size
            js_header_filter main.clear_content_length;
            # Apply the transform plan to response body
            js_body_filter main.transform buffer_type=string;
            proxy_pass http://backend;
        }

        location /api/errors/ {
            js_header_filter main.clear_content_length;
            # Status-conditional: drops stack_trace on 404, masks on 500
            js_body_filter main.transform_with_status buffer_type=string;
            proxy_pass http://backend;
        }
    }
}
```

The `js_header_filter main.clear_content_length` is required when the transform changes the body size. It clears the upstream `Content-Length`, causing nginx to use `Transfer-Encoding: chunked` for the client response.

## Public Gleam API

### Plan model (`response_transform/plan`)

| Type | Description |
|---|---|
| `Operation` | `MaskField(path)`, `DropField(path)`, `RenameField(from, to)`, `SetField(path, value)`, `WhenStatus(status, op)` |
| `Plan` | Named ordered list of operations |
| `PlanError` | `EmptyPlan` or `ConflictingOperations(path)` |

| Function | Description |
|---|---|
| `demo_plan()` | Default plan: mask `user.email`, drop `internal.trace`, rename `user.id` to `user_id` |
| `validate(Plan)` | Returns `Ok(Plan)` or `Error(PlanError)` |
| `compose(List(Plan))` | Merge multiple plans into one, preserving operation order |
| `summary(Plan)` | Human-readable string of all operations |

### Evaluation (`response_transform/eval`)

| Function | Description |
|---|---|
| `apply(Plan, Dict(String,String))` | Apply all operations unconditionally to a field map |
| `apply_at_status(Plan, Int, Dict(String,String))` | Apply operations, evaluating `WhenStatus` ops only when the status matches |

### Body filter adapter (`response_transform/body`)

| Function | Description |
|---|---|
| `filter(Plan, r, data, flags)` | `js_body_filter` adapter; parses JSON body, applies plan, re-encodes |
| `filter_with_status(Plan, Int, r, data, flags)` | Same with status-conditional ops |
| `parse_object(String)` | Parse flat JSON object to `Dict(String,String)`; returns error on non-string values |
| `encode_object(Dict(String,String))` | Encode back to a JSON object string |

### Limitation

`body.parse_object` handles JSON objects where all values are strings. Fields with numeric, boolean, or nested object values cause the original body to pass through unchanged. This covers the primary use case (PII masking of string fields like `email` and `name`) without full JSON tree manipulation.

## Works well with

- [Response Templating](/docs/reference/scripted-modules/response-templating) for generating fresh responses instead of mutating existing ones. Transform edits; templating generates.
- [Workflow](/docs/reference/scripted-modules/workflow) for shaping upstream call results before returning to the client.
- [Webhook](/docs/reference/scripted-modules/webhook) for payload normalization in outbound deliveries.
- [AuthZ](/docs/reference/scripted-modules/authz) for formatting denied responses with consistent field handling.
- [Metrics](/docs/reference/scripted-modules/metrics) for tracking transform and pass-through rates per status code.
