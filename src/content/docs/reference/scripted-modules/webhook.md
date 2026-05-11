---
title: Webhook Signing and Delivery
description: Sign outbound webhooks, verify inbound callbacks, and manage delivery with retry semantics from inside nginx.
---

# Webhook Signing and Delivery

Use this module when nginx sends signed events to another system or receives signed callbacks from vendors and internal services. It gives you one consistent place to handle both sides of that exchange.

## When to use this module

- You need nginx to sign outbound payloads with HMAC-SHA256 before forwarding them to a webhook endpoint.
- You need to verify inbound callback signatures so you know the sender is real and the payload was not tampered with.
- You want configurable retry behavior for outbound delivery on timeouts, fetch failures, and 5xx responses.
- You are composing `http_client` for upstream calls and need signing to be a first-class part of the delivery path rather than ad-hoc string building in a handler.

## nginx.conf synthesis

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        # Outbound: sign and deliver a webhook to a configurable target
        location /deliver {
            js_content main.deliver_demo;
        }

        # Inbound: verify a callback signature against the body
        location /verify {
            js_content main.verify_demo;
        }

        # Inspect the current webhook configuration summary
        location /describe/outbound {
            js_content main.describe_outbound;
        }

        location /describe/inbound {
            js_content main.describe_inbound;
        }
    }
}
```

For outbound delivery, runtime overrides like `$webhook_demo_url` and `$webhook_demo_timeout_ms` let you control the target and timeout without changing the config. For inbound verification, place the handler behind a `proxy_pass` or `auth_request` that receives the callback.

## Public Gleam API

### Config model (`webhook/spec`)

| Type | Description |
|---|---|
| `WebhookConfig` | Named descriptor with algorithm, delivery mode, url, secret, headers, timeout, retry settings |
| `Algorithm` | Currently `HmacSha256` |
| `DeliveryMode` | `Outbound` or `Inbound` |
| `ConfigError` | Typed validation errors: `EmptyName`, `EmptyUrl`, `EmptySecret`, `InvalidTimeout`, `InvalidRetryAttempts`, `MissingSignatureHeader` |

| Function | Description |
|---|---|
| `validate(WebhookConfig)` | Returns `Ok(WebhookConfig)` or `Error(ConfigError)` |
| `summary(WebhookConfig)` | Human-readable config description |
| `demo_outbound()` | Example outbound config for testing |
| `demo_inbound()` | Example inbound config for testing |

### Signing and verification (`webhook/sign`)

| Function | Description |
|---|---|
| `sign(WebhookConfig, String)` → `Promise(String)` | Hex-encoded HMAC-SHA256 signature of the payload |
| `verify(WebhookConfig, String, String)` → `Promise(Bool)` | Case-insensitive, constant-time comparison |
| `signature_header(WebhookConfig, String)` → `#(String, String)` | Header name-value tuple for the signed request |

### Outbound delivery (`webhook/deliver`)

| Function | Description |
|---|---|
| `deliver(WebhookConfig, String)` → `Promise(Result(Response, DeliveryError))` | Signs the payload and sends it via `http_client` |
| `deliver_with_retry(WebhookConfig, String)` → `Promise(Result(Response, DeliveryError))` | Same as deliver but retries on timeouts, fetch failures, and 5xx |
| `DeliveryError` | `ConfigInvalid`, `SignFailed`, `UpstreamFailed` |

### Inbound verification (`webhook/verify`)

| Function | Description |
|---|---|
| `extract_signature(Dict(String,String), WebhookConfig)` → `Result(String, VerifyError)` | Case-insensitive header lookup |
| `verify_request(Dict(String,String), String, WebhookConfig)` → `Promise(Result(Nil, VerifyError))` | Full signature check against body |
| `VerifyError` | `MissingSignature`, `InvalidSignature`, `InvalidPayload` |

## Works well with

- [HTTP Client](/docs/reference/scripted-modules/http-client) for outbound delivery, retry, and timeout semantics.
- [Response Transform](/docs/reference/scripted-modules/response-transform) for shaping callback payloads before delivery.
- [Metrics](/docs/reference/scripted-modules/metrics) for tracking webhook delivery success and failure rates.
- [MLCache](/docs/reference/scripted-modules/mlcache) for future idempotency and replay protection patterns.
