---
title: Native Module Reference
description: Plain-language entry point for every native nginz module, organized as one connected story from security and traffic to data, caching, observability, and runtime extensions.
---

# Native Module Reference

This page is the front door to the native nginz module family.

Read it when you want the full story in plain words: how nginz protects traffic, shapes requests, connects to data systems, coordinates workers, exposes visibility, and extends behavior at the edge.

Use the links below as a natural table of contents. Each category is one part of the platform story, and together they explain how the native module set fits into a real deployment.

The reference pages themselves answer four practical questions quickly:

1. What problem does this module solve?
2. When is it actually useful?
3. What does the nginx.conf shape look like?
4. Which other nginz modules work well with it?

## Security and identity

Security is where most nginz deployments begin: first establish trust, then decide who is allowed through. [ACME and Let's Encrypt](/docs/reference/modules/acme) handles certificate issuance, [JWT Authentication](/docs/reference/modules/jwt) validates bearer tokens, [OpenID Connect](/docs/reference/modules/oidc) runs the browser login flow, [Web Application Firewall](/docs/reference/modules/waf) inspects requests for attack patterns, and [nftables IP Policy](/docs/reference/modules/nftset) blocks or allows clients at the IP layer. Together, these modules define the security envelope before traffic reaches your applications.

## Traffic control and resilience

Once traffic is trusted, nginz decides how to steer it safely. [Canary Routing](/docs/reference/modules/canary) releases changes gradually, [Circuit Breaker](/docs/reference/modules/circuit-breaker) stops repeated backend failure from cascading, [Rate Limiting](/docs/reference/modules/ratelimit) protects services from overload and abuse, [Dynamic Upstreams](/docs/reference/modules/dynamic-upstreams) changes backend membership without reloads, and [Upstream Balancer](/docs/reference/modules/upstream-balancer) keeps sticky routing aligned with live peer health. This category is the operational control layer for live traffic.

## Discovery, data, and transformation

After routing decisions are in place, nginz can also become the place where data is discovered, validated, fetched, and reshaped. [Consul Integration](/docs/reference/modules/consul) connects service discovery to runtime config, [Redis Integration](/docs/reference/modules/redis) gives nginz direct access to hot data and counters, [PostgREST-compatible PostgreSQL API](/docs/reference/modules/pgrest) exposes database-backed APIs, [GraphQL Gateway](/docs/reference/modules/graphql) enforces GraphQL request policy, [JSON Schema Validation](/docs/reference/modules/jsonschema) rejects bad payloads early, and [JSON Response Transform](/docs/reference/modules/transform) trims upstream JSON to the shape clients actually need.

## Cache and coordination

High-performance edge systems need both cache control and cross-worker coordination. [Cache Tags](/docs/reference/modules/cache-tags) groups cached responses by business meaning, [Cache Purge API](/docs/reference/modules/cache-purge) invalidates those groups safely, and [Worker Events](/docs/reference/modules/worker-events) broadcasts state changes across workers without polling. This is the category that keeps distributed edge state coherent.

## Observability and diagnostics

Reliable systems need to explain what they are doing. [Health Checks](/docs/reference/modules/healthcheck) reports readiness and probes backends, [Prometheus Metrics](/docs/reference/modules/prometheus) exports request and latency telemetry, [Request ID](/docs/reference/modules/requestid) gives each request a trace handle, [Echoz Debug Output](/docs/reference/modules/echoz) helps inspect live request data, and [Hello](/docs/reference/modules/hello) provides the simplest possible smoke-test endpoint. This category is where operators confirm the system is healthy and understandable.

## Runtime and ecosystem

[NJS (JavaScript) Orchestration](/docs/reference/modules/njs) extends nginz with request-time logic and subrequest composition, while [WeChat Pay Gateway](/docs/reference/modules/wechatpay) shows how native modules can package a specific external protocol as a first-class edge capability. This last category is the expansion layer: the place where nginz stops being only a traffic system and becomes a programmable application edge.
