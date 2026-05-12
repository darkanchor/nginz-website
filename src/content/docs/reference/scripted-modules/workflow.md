---
title: Workflow
description: Subrequest orchestration and fetch-driven enrichment pipelines for nginx. Run steps in parallel, chain them sequentially, add retries and timeouts, and combine results.
---

# Workflow

Use this module when an incoming request depends on several other systems and nginx needs to coordinate them. It treats a multi-step flow as a first-class value: you describe the pipeline, decide which steps run in parallel versus in sequence, choose what happens when a step fails, and merge the results into a single response.

Workflow is the scripted composition layer that makes the rest of the module ecosystem more useful. It has two backends: `subrequest_step` for nginx internal locations (same worker, no network hop) and `fetch_step` for external HTTP calls delegated through `http_client`.

## When to use this module

- You need to fan out to multiple backends in parallel and combine their responses.
- You need to chain operations where the output of one step feeds the next.
- You want to add resilience to your orchestration: retries, timeouts, fallback values, and degraded-mode responses.
- You are building an enrichment pipeline that calls auth, profile, and feature services before responding to the client.
- You want to wrap a step with read-through caching via `mlcache` to skip expensive origin fetches.

## nginx.conf synthesis

The module exports handler functions that wire to locations with `js_content`. Internal subrequest backends are declared as internal locations with `return` or native module directives.

### Basic chain and sequential orchestration

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        # Single subrequest to /internal/upstream, proxies status and body
        location /chain {
            js_content main.chain;
        }

        # Fetch through http_client (external HTTP via ngx.fetch())
        location /fetch-chain {
            js_content main.fetch_chain;
        }

        # Two subrequests in order, bodies joined
        location /sequential {
            js_content main.sequential;
        }

        # Retry wrapper
        location /retry {
            js_content main.retry;
        }

        # Timeout wrapper
        location /timeout {
            js_content main.timeout;
        }

        # Fallback body when upstream fails
        location /recover-demo {
            js_content main.recover_demo;
        }

        # First successful response from two upstreams
        location /first-ok-demo {
            js_content main.first_ok_demo;
        }

        # Transform upstream body (uppercase)
        location /map-body-demo {
            js_content main.map_body_demo;
        }

        # Aggregate success/failure counts
        location /summary {
            js_content main.summary;
        }

        # Internal backends (only reachable via subrequest)
        location /internal/upstream {
            internal;
            return 200 "upstream-response";
        }

        location /internal/upstream-a {
            internal;
            return 200 "response-a";
        }

        location /internal/upstream-b {
            internal;
            return 200 "response-b";
        }

        location /internal/unreliable {
            internal;
            return 500;
        }

        # Fixture for external fetch
        location = /__fixture/upstream {
            return 200 "fixture-response";
        }
    }
}
```

### Enrichment fan-out (parallel subrequests)

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        # Fans out to /internal/auth and /internal/profile in parallel,
        # joins bodies with newline, returns 502 if either fails.
        location /enrich {
            js_content main.enrich;
        }

        # Native module backends serve these internal locations
        location /internal/auth {
            internal;
            echozn '{"ok":true}';
        }

        location /internal/profile {
            internal;
            echozn '{"name":"alice","id":1}';
        }
    }
}
```

### Cache-aware orchestration

Workflow integrates with mlcache to wrap steps with read-through or stale-while-refresh caching. This requires a `js_shared_dict_zone` for the cache backend.

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    js_shared_dict_zone zone=workflow_cache:1m timeout=1h;

    server {
        listen 8888;

        # Read-through cache: first request hits upstream, subsequent served from cache
        location /cached-workflow {
            js_content main.cached_workflow;
        }

        # Stale-while-refresh: serve stale cached response while refreshing in background
        location /stale-demo {
            js_content main.stale_demo;
        }

        location /internal/upstream {
            internal;
            return 201 "upstream-response";
        }
    }
}
```

## Public Gleam API

### `workflow/pipeline` — core orchestration

- **`StepResult`** — a sum type with two variants: `Fetched(status: Int, body: String)` for success and `Failed(reason: String)` for failure. Errors are values, not exceptions.
- **`Step`** — a type alias for `fn(njs.http.Request) -> Promise(StepResult)`. Steps are composable values.
- `run_parallel(steps, request)` — dispatches all steps in parallel via `Promise.all`. Returns a list of `StepResult` values in the same order as the input steps.
- `run_sequential(steps, request)` — runs steps one at a time in order, with optional short-circuiting on the first failure.
- `subrequest_step(path)` — creates a step that issues an nginx internal subrequest to a given URI path. Runs in the same worker with no extra network hop.
- `fetch_step(url)` — creates a step that performs an external HTTP fetch via `http_client/fetch.execute()`. Maps all `ClientError` variants to `Failed(reason)`.
- `fetch_step_with_opts(build)` — like `fetch_step`, but accepts a `Request` builder function for full control over method, headers, body, and query params.
- `and_then(step, fn(StepResult) -> Step)` — chains a dependent step that receives the previous step's result.
- `map_result(step, fn(StepResult) -> StepResult)` — transforms a step's result.
- `map_body(step, fn(String) -> String)` — transforms the body of a successful step result.
- `map_error(step, fn(String) -> String)` — transforms the failure reason of a failed step result.
- `with_timeout(step, timeout_ms)` — wraps a step with a client-observed timeout.
- `with_retry(step, max_attempts)` — wraps a step with immediate retry on failure, up to the configured max.
- `recover(step, fallback_body)` — wraps a step so that failure produces a `Fetched` result with the fallback body instead of `Failed`.
- `first_ok(steps, request)` — runs all steps in parallel and returns the first successful result, discarding failures.
- `all_success(results)` — returns `True` if every `StepResult` in the list is `Fetched`.
- `partition(results)` — splits a list of `StepResult` into `(ok_list, failed_list)`.
- `summary(results)` — returns aggregate counts as `"ok=N fail=M"`.
- `filter_ok(results)` — extracts `(status, body)` pairs from successful results, discarding failures.
- `fail_on_status(step, statuses)` — wraps a step so that specific HTTP status codes are treated as failures.

### `workflow/merge` — result combinators

- `merge_bodies(results, delimiter)` — joins the bodies of all successful results with a delimiter string.
- `merge_with(results, combiner)` — custom merge strategy: applies a function over the list of successful results.
- `require_all(results, default)` — returns the merged bodies if every step succeeded, otherwise returns the default.
- `select_first_ok(results, default)` — returns the body of the first successful result, or the default if all failed.

### `workflow/cache` — cache-aware step helpers

- `cached_step(step, dict_name, key, ttl_s)` — wraps a step with read-through cache semantics. On cache hit, returns the cached result immediately. On miss, runs the step, stores the result in `mlcache`, and returns.
- `stale_while_refresh(step, dict_name, key, ttl_s, stale_ttl_s)` — like `cached_step`, but serves stale cached results while a background refresh completes.

### Exports (njs entry point)

The main module `nginz_njs_workflow.gleam` exports these handlers for `js_content`:

| Export | Description |
|---|---|
| `main.enrich` | Fan-out to `/internal/auth` and `/internal/profile` in parallel |
| `main.chain` | Single sequential subrequest |
| `main.fetch_chain` | External HTTP fetch via http_client |
| `main.sequential` | Two subrequests in order with merged bodies |
| `main.retry` | Step with retry wrapper |
| `main.timeout` | Step with timeout wrapper |
| `main.recover_demo` | Step with fallback body on failure |
| `main.first_ok_demo` | First successful response from parallel upstreams |
| `main.map_body_demo` | Body transformation (uppercase) |
| `main.summary` | Aggregate success/failure counts |
| `main.templated_parallel` | Parallel subrequests with response_templating for JSON shaping |
| `main.degraded_parallel` | Required + optional branches with structured full/degraded JSON |
| `main.cached_workflow` | Read-through cache wrapped subrequest |
| `main.stale_demo` | Stale-while-refresh cache wrapped subrequest |

## Works well with

- Stock nginx `internal` directive — mark workflow step locations as internal so they can only be reached via subrequest.
- [HTTP Client](/docs/reference/scripted-modules/http-client) — provides the external HTTP backend for `fetch_step` and `fetch_step_with_opts`.
- [MLCache](/docs/reference/scripted-modules/mlcache) — provides read-through and stale-while-refresh cache semantics for workflow steps via `workflow/cache`.
- [NJS](/docs/reference/modules/njs) — njs subrequests are the primary internal backend for workflow steps.
- [Echoz](/docs/reference/modules/echoz) — useful as a lightweight internal response backend when testing enrichment pipelines.
- [Response Templating](/docs/reference/scripted-modules/response-templating) — workflow hands off final JSON shaping to `response_templating` when orchestration should not own body construction.
- [Circuit Breaker](/docs/reference/modules/circuit-breaker) — circuit-aware step wrappers (`skip_when_open`, `recover_when_open`) compose resilience patterns into workflow pipelines.
