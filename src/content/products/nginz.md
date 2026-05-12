---
title: nginz
license: Apache-2.0
category: Open Source
tagline: Native modules for stock nginx. Active health checks, dynamic upstreams, JWT auth, Prometheus metrics — free, no fork, no patch.
---

# nginz

## The concern

You run nginx in production. It's fast, it's stable, and your team knows how to configure it. But as your deployment grows, you keep running into the same wall: stock nginx gives you a great reverse proxy, and not much else.

Here are the situations operations teams face every day:

**You're deploying a new version of your backend.** You want to send 5% of traffic to it, watch the error rate for ten minutes, then ramp to 50%. Stock nginx can split traffic with `split_clients`, but the split is random per request — the same user bounces between versions, and there's no way to force a header like `X-Canary: 1` to pin a tester to the new version. You end up running two nginx instances or building a custom Lua script.

**You're adding three new backend servers.** You edit the upstream block, run `nginx -s reload`, and watch every in-flight request drop. Your users see connection resets. Your monitoring fires alerts. You schedule deployments for 3 AM to minimize the blast radius. Stock nginx loads upstreams at startup. Changing them means reloading. Reloading means dropping connections.

**Your PostgreSQL primary went down.** The standby promoted, but your nginx upstreams still point at the old IP. You need to switch without touching nginx config — ideally, nginx should discover the new primary from Consul and update its upstreams automatically. Stock nginx can't do any of this.

**A backend starts returning 500s under load.** Every retry from nginx makes it worse. You need nginx to detect the failure pattern, stop sending traffic for 30 seconds, then probe carefully before letting traffic back. Stock nginx has `max_fails` and `fail_timeout`, but no half-open recovery, no success threshold, no state you can inspect. You're guessing whether the backend is healthy again.

**Your security team requires JWT validation at the edge.** You set up `auth_request` to call an internal auth service. Now you're maintaining that auth service — deploying it, monitoring it, making sure it doesn't become the bottleneck. For something as simple as "check this token's signature and extract the user ID," you're running a separate application.

**Your API is getting hammered by a single IP.** You need rate limiting. Stock nginx has `limit_req`, but it's leaky-bucket only — no fixed-window counters, no shared state across workers, no way to inspect who's hitting the limit right now. You add Redis just for rate limit counters, and now Redis is a hard dependency for your proxy.

**You need Prometheus metrics.** Stock nginx gives you the stub status page — request count, connections, that's it. No histograms. No per-location counters. No upstream response times. You install nginx-prometheus-exporter as a sidecar. It scrapes the stub status page and translates it. It works, mostly, but it's another process to run, and the data is coarse.

**Your CMS published a breaking change to an article.** You need to purge every cached page that includes that article — the article page itself, the category listing, the homepage featured section, the RSS feed. Stock nginx can purge by exact URL only. You'd need to know every URL where that content appears and send a PURGE for each one. In practice, you don't — you set a short cache TTL and accept the extra backend load.

**You're building a service mesh.** You need cross-worker communication — when one worker detects a backend failure, all workers should know. Stock nginx workers are independent processes connected only through shared memory and the kernel. There's no event mechanism. You rely on each worker discovering failures independently, meaning some workers route to a dead backend for seconds after others have already marked it down.

These aren't edge cases. They're what happens when you run nginx beyond a single-backend, single-location setup. And the commercial alternative — NGINX Plus — covers some of them at $3,500 per instance per year, while still missing Consul discovery, native Prometheus histograms, and cross-worker events.

## What stock nginx is missing

To be clear about the gaps:

| You need | Stock nginx | NGINX Plus | nginz |
|---|---|---|---|
| Active HTTP health checks | ❌ | ✅ $3,500/yr | ✅ Free |
| Dynamic upstreams (no reload) | ❌ | ✅ $3,500/yr | ✅ Free |
| Sticky sessions | ❌ | ✅ $3,500/yr | ✅ Free |
| JWT validation at the edge | ❌ | ❌ | ✅ Free |
| OIDC SSO login flow | ❌ | ❌ | ✅ Free |
| WAF (SQLi, XSS detection) | ❌ | ❌ | ✅ Free |
| Rate limiting (fixed window, shared) | Partial | Partial | ✅ Free |
| Canary routing (header/cookie) | ❌ | ❌ | ✅ Free |
| Circuit breaker (half-open recovery) | ❌ | ❌ | ✅ Free |
| Consul service discovery | ❌ | ❌ | ✅ Free |
| Prometheus metrics (histograms) | ❌ | ❌ | ✅ Free |
| Cache tagging and grouped purge | ❌ | ❌ | ✅ Free |
| Cross-worker event broadcast | ❌ | ❌ | ✅ Free |
| PostgreSQL REST API at the edge | ❌ | ❌ | ✅ Free |

Every feature nginz provides runs on stock nginx — the same binary you already have in production. No fork, no patch, no custom compile flags beyond the standard `--add-module`.

## Our approach

nginz is 26 native modules. Each one solves a specific gap in stock nginx. You enable the ones you need. They work together because they share the same nginx internals — a health check result feeds the upstream balancer, a rate limit counter is visible to the WAF, a worker event reaches every worker process.

The modules load into nginx the way nginx modules always have: at compile time with `--add-module`, or at runtime with `load_module` for dynamic `.so` loading. You don't replace your nginx binary with ours. You add modules to yours.

Let's walk through how the modules solve the scenarios above.

### Deploying safely: canary + circuit breaker + health checks

You configure the canary module to send 5% of traffic to the new backend version, with the option to force traffic via an `X-Canary` header for your testers. The circuit breaker watches for failure patterns — if the new version starts returning 500s, the breaker opens and traffic stops going there. Meanwhile, active health checks probe the backend independently, and when the health check passes again, the breaker allows a few test requests through before declaring the backend healthy. You don't need a separate deployment tool or a custom Lua script. This is nginx config:

```nginx
location /api {
    canary_percentage 5;
    canary_header X-Canary;
    circuit_breaker_threshold 5;
    circuit_breaker_timeout 30s;
    circuit_breaker_success_threshold 2;
    proxy_pass http://backend;
}
```

Three directives. Zero external dependencies.

### Upstreams that change without reloads: dynamic-upstreams + consul

You mark an upstream as managed. Now you can change its members at runtime — add a server, remove one, replace the whole set — through a control API, a static JSON file that nginx polls, or Consul service discovery that keeps the upstream in sync with your infrastructure. No reload, no dropped connections.

```nginx
upstream api_backend {
    dynamic_upstreams_managed;
    server 10.0.0.11:8080;
    server 10.0.0.12:8080;
}

location /admin/upstreams {
    dynamic_upstreams_api;
    dynamic_upstreams_target api_backend;
    allow 10.0.0.0/8;
    deny all;
}
```

Send a PUT to `/admin/upstreams` with a new server list. nginx switches atomically. The upstream balancer, if you're using sticky sessions, follows the new membership.

### Identity at the edge: jwt + oidc

You configure the JWT module with your signing key. nginx validates every bearer token in-process — no `auth_request` to a separate service, no network hop, no extra process to maintain. It extracts claims into nginx variables that every other module can read:

```nginx
location /api {
    jwt_key secret my-secret-key;
    jwt_claim_set $jwt_sub sub;
    jwt_claim_set $jwt_role role;
    proxy_pass http://backend;
}
```

For browser-based login, the OIDC module handles the full authorization code flow with PKCE — redirect to the provider, receive the callback, exchange the code, verify the ID token, set a session cookie. nginx becomes the SSO gateway without an application in between.

### Rate limiting that doesn't need Redis: ratelimit

The rate limit counter lives in nginx shared memory, shared across all workers. You set a window and a limit per key (IP, user ID, whatever you extract into a variable). When the limit is hit, nginx returns 429 with a `Retry-After` header. No Redis. No external dependency.

```nginx
location /api {
    ratelimit_zone name=api zone_size=10m rate=100r/m;
    ratelimit_key $binary_remote_addr;
    proxy_pass http://backend;
}
```

### Cache invalidation that makes sense: cache-tags + cache-purge

Your application adds a `Cache-Tag` response header listing what content is in the response: `article-42`, `category-tech`, `homepage-featured`. When article 42 updates, you send one purge request targeting the tag `article-42`. nginx invalidates the article page, the category page, the homepage, and the RSS feed — everything tagged with `article-42` — in one operation. No hunting for URLs. No short TTL workaround.

### Observability that's built in, not bolted on: prometheus + healthcheck

The Prometheus module exports a `/metrics` endpoint with per-location request counts, response times as histograms, upstream response times, and rate limit counters. Your existing Prometheus stack scrapes it like any other target. No sidecar. No translation layer.

The health check module provides active probes with configurable intervals, match rules on the response body, slow-start tracking for newly added peers, and a readiness endpoint that reports the same answer across all workers. The upstream balancer reads health state directly — no separate health check service feeding config changes.

### Module catalog

Every module solves a specific production problem. Follow the links for full documentation, config examples, and integration guidance.

**Security & identity** — establish trust before traffic reaches your application.

- [ACME](/docs/reference/modules/acme) — automatic Let's Encrypt certificate issuance and renewal for single-domain HTTP-01
- [JWT](/docs/reference/modules/jwt) — validate HS256 bearer tokens and extract claims as nginx variables
- [OpenID Connect](/docs/reference/modules/oidc) — browser-based SSO with PKCE and RS256 ID token verification
- [WAF](/docs/reference/modules/waf) — SQL injection and XSS pattern detection in request bodies
- [nftset](/docs/reference/modules/nftset) — kernel-level IP allow/block via nftables Netlink lookup

**Traffic control & resilience** — steer traffic safely and survive backend failure.

- [Canary](/docs/reference/modules/canary) — percentage, header, or cookie-based traffic splitting for gradual rollouts
- [Circuit Breaker](/docs/reference/modules/circuit-breaker) — failure detection with half-open recovery and configurable success threshold
- [Rate Limiting](/docs/reference/modules/ratelimit) — fixed-window counters per IP or custom key, shared across workers
- [Dynamic Upstreams](/docs/reference/modules/dynamic-upstreams) — runtime peer set replacement via API, file polling, or Consul
- [Upstream Balancer](/docs/reference/modules/upstream-balancer) — sticky sessions with cookie/header affinity and health-aware peer selection

**Data, discovery & transformation** — connect nginx to data systems and reshape responses at the edge.

- [Consul](/docs/reference/modules/consul) — service discovery and KV store integration
- [Redis](/docs/reference/modules/redis) — direct access to hot data via RESP protocol, no separate client library
- [pgrest](/docs/reference/modules/pgrest) — PostgreSQL REST API with JWT auth and JSON/CSV/XML content negotiation
- [GraphQL](/docs/reference/modules/graphql) — query depth limiting and introspection control
- [JSON Schema](/docs/reference/modules/jsonschema) — validate request and response bodies against a JSON Schema
- [Transform](/docs/reference/modules/transform) — trim, rename, and reshape upstream JSON before it reaches the client

**Cache & coordination** — keep distributed edge state coherent.

- [Cache Tags](/docs/reference/modules/cache-tags) — attach tags to cached responses for grouped invalidation
- [Cache Purge](/docs/reference/modules/cache-purge) — operator-facing purge API with tag-based and prefix-based invalidation
- [Worker Events](/docs/reference/modules/worker-events) — cross-worker shared-memory event ring with publish and inspect

**Observability** — know what your edge is doing right now.

- [Health Checks](/docs/reference/modules/healthcheck) — active HTTP/HTTPS probes, readiness endpoint, Prometheus metrics
- [Prometheus](/docs/reference/modules/prometheus) — native `/metrics` endpoint with per-location histograms
- [Request ID](/docs/reference/modules/requestid) — UUID4 generation and X-Request-ID propagation
- [Echoz](/docs/reference/modules/echoz) — debug output and variable inspection for development

**Runtime & ecosystem**

- [njs](/docs/reference/modules/njs) — QuickJS engine for request-time scripting and subrequest orchestration
- [WeChat Pay](/docs/reference/modules/wechatpay) — WeChat Pay API signature signing and verification
- [Hello](/docs/reference/modules/hello) — minimal smoke-test endpoint for verifying module loading

## Why we write modules in Zig

A nginx module sits inside the nginx process. If it crashes, nginx crashes. If it leaks memory, nginx grows until the OOM killer steps in. If it has undefined behavior — a use-after-free, a buffer overflow — the failure is silent until it isn't, and debugging it means reading core dumps.

We write in Zig because the language eliminates entire categories of bugs that are common in C module development. Zig catches null pointer dereferences at compile time. Array accesses are bounds-checked in debug and release-safe builds. Memory is managed explicitly — no garbage collector — but the allocator interface makes leaks visible and testable. There is no undefined behavior in safe build modes. When we upgrade nginx and struct layouts change, Zig's compile-time reflection catches mismatches before the module loads.

For you, this means modules that won't destabilize your nginx. For us, it means we ship features faster because we spend less time tracking down memory corruption and more time building what you need.

But you don't need to know Zig to use nginz. The modules are nginx modules — they load the way nginx modules have always loaded. Zig is how we build them. Reliability is what you get.
