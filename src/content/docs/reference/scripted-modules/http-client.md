---
title: HTTP Client
description: Typed ngx.fetch() wrapper for making outgoing HTTP calls from nginx. Build requests with a clean builder API, control timeouts and retries, and compose with middleware.
---

# HTTP Client

Use this module when nginx needs to call another service: an auth provider, a profile API, an internal microservice, or a webhook target. It wraps `ngx.fetch()` with a typed request model so your handler code stays readable and you stop repeating the same header, token, and timeout setup across every endpoint.

The module is built in three layers: a pure request builder, an execution layer that translates the builder output into an actual HTTP call, and a policy layer for retries and middleware.

## When to use this module

- You need nginx to call an external or internal HTTP service and use the response in your handler.
- You want to keep request construction clean and reusable instead of writing raw `ngx.fetch()` calls with inline header and body logic.
- You need retry semantics, request timeouts, or composable header/auth middleware.
- You are writing a module (such as workflow or webhook) that needs to make HTTP calls as part of a larger orchestration step.

## nginx.conf synthesis

The module exports handler functions that you wire to nginx locations with `js_content`. Each handler demonstrates a different usage pattern.

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        # Pure request model: return a deterministic summary string
        location /demo {
            js_content main.demo;
        }

        # Real ngx.fetch() to a fixture upstream
        location /fetch-demo {
            js_content main.fetch_demo;
        }

        # Full builder pipeline: method, headers, body, query params, auth, timeout
        location /request-demo {
            js_content main.request_demo;
        }

        # Stacked middleware pipeline (bearer token, headers, content-type, timeout)
        location /middleware-demo {
            js_content main.middleware_demo;
        }

        # Fetch with retry policy (max 3 attempts)
        location /retry-demo {
            js_content main.retry_demo;
        }

        # Error paths: InvalidUrl returns 400, Timeout returns 504
        location /invalid-url-demo {
            js_content main.invalid_url_demo;
        }

        location /invalid-request-demo {
            js_content main.invalid_request_demo;
        }

        location /timeout-demo {
            js_content main.timeout_demo;
        }

        # Fixture backend used by the demo handlers
        location = /__fixture/upstream {
            return 200 "fixture-response";
        }
    }
}
```

Each `js_content main.<handler>` directive pairs a public URL path with a Gleam handler compiled to JavaScript. The handler receives the njs request object, builds or configures an HTTP call, executes it, and returns the result.

## Public Gleam API

The module is organized into submodules that separate concerns: request construction, execution, policy, middleware, and response handling.

### `http_client/client` — pure request model

Build a request with a typed descriptor instead of raw JavaScript objects:

- **`Method`** — a sum type with seven variants: `Get`, `Head`, `Post`, `Put`, `Patch`, `Delete`, `Options`.
- **`Request`** — a typed record with fields for `url`, `method`, `headers` (list of key-value pairs), `auth_header` (convenience for Bearer tokens), `body` (optional string), `query_params` (list of key-value pairs), and `timeout_ms`.
- Builder helpers: `with_method`, `with_header`, `with_headers`, `with_bearer_token`, `with_body`, `with_query_param`, `with_query_params`, `with_timeout`. Each returns a new `Request` with the field updated, keeping construction pure.
- `build_url(request)` — assembles the final URL with query parameters appended.
- `summary(request)` — deterministic string rendering for testing and debugging.

### `http_client/fetch` — execution layer

- **`Response`** — a record with `status: Int` and `body: String`. A `Response` means the HTTP exchange completed, regardless of status code.
- **`execute(request)`** — converts the pure `Request` into an njs fetch call, returns `Promise(Result(Response, ClientError))`. Handles header merging, body encoding, query param appending, and catch-all error wrapping.
- Response classification helpers: `is_success` (2xx), `is_client_error` (4xx), `is_server_error` (5xx), `is_redirect` (3xx), `status_text` (maps status code to reason phrase).

### `http_client/response` — body extraction

- `body_or(response, fallback)` — returns the body for 2xx responses, otherwise the fallback string.
- `body_if_success(response)` — returns `Ok(body)` for 2xx, `Error(body)` otherwise.
- `body_if_status(response, status)` — returns `Ok(body)` if the status matches, `Error(body)` otherwise.

### `http_client/policy` — retry composition

- **`RetryPolicy`** — `NoRetry` or `Retry(max_attempts: Int)`.
- `new()` — creates a default policy with no retry.
- `with_retry(policy, retry_policy)` — attaches a retry configuration.
- `execute_with_policy(request, policy)` — runs `execute()` with the given policy, retrying immediately on failure up to the configured max.

Retry is immediate only; njs timer callbacks run outside the request context and cannot safely call `ngx.fetch()` after a delay.

### `http_client/middleware` — composable transforms

- **`Middleware`** — a type alias for `fn(Request) -> Request`.
- `stack(middlewares)` — composes a list of middlewares left to right into a single transform.
- Pre-built middlewares: `bearer_token(token)`, `add_header(key, value)`, `json_content_type()`, `timeout_ms(ms)`.

Apply middleware to a request with `middleware.apply(mw, request)` before passing it to `execute()`.

### Exports (njs entry point)

The main module `nginz_njs_http_client.gleam` exports handler functions that nginx calls via `js_content`:

| Export | Description |
|---|---|
| `main.demo` | Renders a stable request summary string |
| `main.fetch_demo` | Performs a real `ngx.fetch()` to a fixture upstream |
| `main.request_demo` | Full builder pipeline: headers, body, query params, auth, timeout |
| `main.middleware_demo` | Stacked middleware pipeline |
| `main.retry_demo` | Fetch with retry policy |
| `main.invalid_url_demo` | Invalid URL error path (returns 400) |
| `main.invalid_request_demo` | Invalid request error path (returns 400) |
| `main.timeout_demo` | Client-observed timeout path (returns 504) |

### Error model

```gleam
pub type ClientError {
  FetchFailed(reason: String)      // transport or runtime failure
  Timeout(timeout_ms: Int)         // client-observed timeout
  InvalidUrl(url: String)          // malformed or unsupported URL
  InvalidRequest(reason: String)   // invalid request configuration
}
```

Each variant maps to a distinct HTTP response status in the demo handlers, showing how the typed error surface lets callers distinguish failure modes.

## Works well with

- Stock nginx `proxy_set_header` — set custom headers on outbound requests the HTTP client makes.
- [Workflow](/docs/reference/scripted-modules/workflow) — uses `http_client/fetch` as its external HTTP backend for `fetch_step` and `fetch_step_with_opts`.
- [NJS](/docs/reference/modules/njs) — njs provides the underlying `ngx.fetch()` runtime that http_client wraps.
- [Healthcheck](/docs/reference/modules/healthcheck) — combine with healthcheck probes to gate fetch targets.
- [Request Tracing](/docs/reference/scripted-modules/request-tracing) — wrap fetch calls with tracing context propagation.
