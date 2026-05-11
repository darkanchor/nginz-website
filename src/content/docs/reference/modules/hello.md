---
title: Hello
description: A minimal smoke-test endpoint that returns a literal "hello" response. Useful for verifying nginz is running and routing correctly.
---

# Hello

Use this module when you need a dead-simple endpoint to confirm nginz is serving traffic. It returns `200 OK` with the literal body `hello`. Nothing more.

## When to use this module

- You want a health or smoke-test endpoint that does not depend on any backend.
- You are setting up a new nginz deployment and want to verify the config loads and routes work before wiring up real backends.
- You need a target for load balancer health checks that has zero dependencies.

## nginx.conf synthesis

```nginx
location /hello {
    hello;
}
```

That is the whole config. Every request to `/hello` returns status `200` and body `hello`. Works with any HTTP method including `HEAD` and `POST`.

## Directive reference

### `hello`

- **Contexts:** `location`
- **Default:** none

Enables the hello handler for the enclosing location. No arguments, no subdirectives. When present, any request to that location receives the literal `hello` response.

## Works well with

- [Circuit Breaker](/docs/reference/modules/circuit-breaker) for health-check targets that must never trip on backend failures.
- [Consul](/docs/reference/modules/consul) when you want a local health endpoint alongside service-discovery-managed upstreams.
