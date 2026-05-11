---
title: Request ID
description: Generate and propagate unique request IDs for distributed tracing through nginx and upstream services.
---

# Request ID

Use this module when you need every request to carry a traceable identifier across your infrastructure.

## When to use this module

- You want end-to-end request tracing from the edge through upstream services.
- You need a unique ID in access logs to correlate requests across workers.
- You want to preserve an incoming request ID from a client or load balancer.
- You need a custom header name for your tracing or correlation convention.
- You want the request ID in response headers for debugging or client-side correlation.

## nginx.conf synthesis

Enable request ID on a location and forward it to the upstream:

```nginx
http {
    log_format traced '$remote_addr - $ngz_request_id - $status "$request"';

    server {
        access_log /var/log/nginx/access.log traced;

        location /api {
            request_id_response on;
            proxy_set_header X-Request-ID $ngz_request_id;
            proxy_pass http://backend;
        }

        location /internal {
            request_id_response off;
            proxy_pass http://backend;
        }
    }
}
```

Use a custom header name instead of the default:

```nginx
location /traced {
    request_id_header X-Correlation-ID;
    proxy_pass http://backend;
}
```

## Directive reference

### `request_id_header`

- **Contexts:** `location`
- **Default:** `X-Request-ID`

Enables request ID generation and sets the header name to use for both incoming matching and outgoing response. When the client sends a matching header, its value is preserved. When absent, a new UUID4 is generated.

### `request_id_response`

- **Contexts:** `location`
- **Default:** `on`

Controls whether the request ID is added to response headers. Set to `off` when you want internal-only tracking without exposing the ID to clients.

## Variables

| Variable | Description |
|---|---|
| `$ngz_request_id` | The request ID for the current request: either the incoming header value or a newly generated UUID4 |

## Behavior notes

- Generated IDs follow RFC 4122 UUID version 4 format: 36 characters with version and variant nibbles.
- Uses cryptographically secure random bytes from Zig's standard library.
- Incoming headers are matched case-insensitively.
- The same ID is available in access logs, upstream proxy headers, and response headers, making it a single correlation handle for the whole request lifecycle.

## Works well with

- [Rate Limiting](/docs/reference/modules/ratelimit) for correlating rate-limited requests in logs.
- [Health Checks](/docs/reference/modules/healthcheck) when you want to trace probe activity alongside user traffic.
- [Upstream Balancer](/docs/reference/modules/upstream-balancer) for correlating sticky session requests across retries.
