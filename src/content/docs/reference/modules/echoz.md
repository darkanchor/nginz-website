---
title: Echoz Debug Output
description: Return text, variables, request bodies, and simple wrapped responses directly from nginx for debugging and utility endpoints.
---

# Echoz Debug Output

Use this module when you need nginx itself to emit a response for debugging, diagnostics, or small utility endpoints.

## When to use this module

- You want a quick debug endpoint without involving an application upstream.
- You need to inspect request variables or request bodies during integration work.
- You want to wrap another upstream response with simple prefix or suffix content.
- You need lightweight internal redirects or fire-and-forget subrequests.

## nginx.conf synthesis

Use `echoz` for direct response output or use the body-filter directives to wrap another response.

```nginx
location /debug/info {
    echoz "Method: $request_method";
    echoz "URI: $uri";
}

location /wrapped {
    echoz_before_body "<html><body>";
    echoz_after_body "</body></html>";
    proxy_pass http://backend;
}
```

This is most useful for controlled internal endpoints, diagnostics, and simple response shaping.

## Directive reference

### `echoz`

- **Contexts:** `location`
- **Default:** disabled

Outputs text with a trailing newline. Use it when readability matters more than strict byte-for-byte output.

### `echozn`

- **Contexts:** `location`
- **Default:** disabled

Outputs text without adding a newline. Use it for JSON fragments or exact response bodies.

### `echoz_duplicate`

- **Contexts:** `location`
- **Default:** disabled

Repeats a string a fixed number of times. It is mostly useful for tests, response shaping experiments, and synthetic payloads.

### `echoz_flush`

- **Contexts:** `location`
- **Default:** disabled

Flushes the current output buffer. Use it when you want nginx to send buffered echo output earlier in the response flow.

### `echoz_sleep`

- **Contexts:** `location`
- **Default:** disabled

Pauses execution for a configured interval. This is mainly a test and diagnostics tool, not a normal production behavior.

### `echoz_request_body`

- **Contexts:** `location`
- **Default:** disabled

Outputs the request body. Use it to inspect incoming payloads on test endpoints.

### `echoz_read_request_body`

- **Contexts:** `location`
- **Default:** disabled

Reads the request body into memory so later echo directives can use it. Pair it with `echoz_request_body` when you want body inspection.

### `echoz_exec`

- **Contexts:** `location`
- **Default:** disabled

Performs an internal redirect to another location. Use it when you want a simple internal handoff instead of returning content directly.

### `echoz_location_async`

- **Contexts:** `location`
- **Default:** disabled

Fires an asynchronous internal subrequest. Use it for background-style internal signaling where the response body is not the main output.

### `echoz_before_body`

- **Contexts:** `location`
- **Default:** disabled

Prepends text to the response body from another handler. It is a lightweight way to wrap or annotate upstream responses.

### `echoz_after_body`

- **Contexts:** `location`
- **Default:** disabled

Appends text after the response body from another handler. Use it with `echoz_before_body` for simple wrapping.

### `echoz_status`

- **Contexts:** `location`
- **Default:** response default

Sets the response status code. Use it when the endpoint should return a controlled non-200 response.

### `echoz_header`

- **Contexts:** `location`
- **Default:** none

Adds a response header. This is useful for debug metadata, test contracts, and simple integration signaling.

## Works well with

- Stock nginx `return` and `rewrite` — use these for simple redirects and static responses; echoz adds variable interpolation, request body inspection, and response wrapping.
- [Request ID](/docs/reference/modules/requestid) when you want debug endpoints to expose tracing values.
- [JSON Schema Validation](/docs/reference/modules/jsonschema) for quick validation-and-echo test flows.
- [njs Runtime](/docs/reference/modules/njs) when you need more logic than static echo directives provide.
