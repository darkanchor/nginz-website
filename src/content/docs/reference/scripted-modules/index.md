---
title: Scripted Module Reference
description: Plain-language entry point for every nginz-njs scripted module, organized as one connected story from HTTP client foundation to policy, orchestration, data shaping, caching, observability, and operations.
---

# Scripted Module Reference

This page is the front door to the nginz-njs scripted module family.

Read it when you want the full story in plain words: how scripted modules turn stock nginx into a programmable edge with typed, composable policy logic written in Gleam and compiled to njs.

Use the links below as a natural table of contents. Each category is one part of the platform story, and together they explain how the scripted module set fits into a real deployment.

The per-module pages answer four practical questions quickly:

1. What problem does this module solve?
2. When is it actually useful?
3. What does the nginx.conf shape look like?
4. Which other scripted or native modules work well with it?

## The building blocks philosophy

Every scripted module has two surfaces. The first is a **reusable Gleam library** under `src/<name>/` with clean public types and functions. The second is a **final njs adapter** in `src/nginz_njs_<name>.gleam`, exposed through `pub fn exports() -> JsObject` that nginx loads via `js_import`. The library surface is the real product. The `exports()` function is the last-mile adapter that turns those building blocks into an nginx-facing module.

Modules are meant to be used by other modules inside and outside this monorepo as ordinary building blocks. An `exports()` function is not required for a module to be useful. Modules compose through standard nginx primitives and through direct Gleam dependency: `workflow` depends on `http_client` as a library, not by reimplementing fetch logic.

This philosophy means you should not design modules as isolated one-off nginx scripts. Design reusable Gleam packages that can also be exported to nginx.

## HTTP client and orchestration

Every scripted deployment needs a foundation for making outbound HTTP requests, composing them into pipelines, and delivering structured payloads to remote systems. [HTTP Client](/docs/reference/scripted-modules/http-client) wraps `ngx.fetch()` with a typed interface, input validation, timeout control, and middleware support. [Workflow](/docs/reference/scripted-modules/workflow) builds on top of that with subrequest orchestration, enrichment pipelines, parallel and sequential runners, retry and timeout wrappers, and merge strategies. [Webhook](/docs/reference/scripted-modules/webhook) completes the picture by composing the HTTP client for signed webhook delivery, callback verification, and reliable outbound messaging. Together these three modules are the transport and orchestration layer for every scripted interaction that leaves the nginx process.

## Policy and access

Once traffic can flow through the edge, you need to decide who and what is allowed through. [Authorization](/docs/reference/scripted-modules/authz) provides composable rule-based policy evaluation: method checks, path matching, header validation, JWT claim inspection, remote OPA integration, and header enrichment. Rules are plain Gleam functions that combine with combinators like `all_of` and `any_of`. [Feature Flags](/docs/reference/scripted-modules/feature-flags) evaluates flag states with stable bucketing for A/B routing and gradual rollouts. [Session](/docs/reference/scripted-modules/session) models cookie lifecycle and provides an `ngx.shared`-backed store that both authorization and feature flag modules consume. This category is where policy is expressed, evaluated, and enriched with per-request context.

## Data and response shaping

After policy decisions are made, the edge often needs to reshape data before returning it to clients. [Response Transform](/docs/reference/scripted-modules/response-transform) applies plan-based JSON field masking, dropping, renaming, and status-conditional operations through a `js_body_filter` adapter. [Response Templating](/docs/reference/scripted-modules/response-templating) generates lightweight responses from request and runtime facts. Response Transform is the scalpel for trimming upstream responses. Response Templating is the authoring tool for building synthetic responses. They are companions, not replacements for each other.

## Caching and state

Scripted modules that evaluate policy, serve flags, or manage sessions need a shared state layer that survives individual requests. [MLCache](/docs/reference/scripted-modules/mlcache) provides a two-level cache with an `ngx.shared` adapter, stale-while-revalidate semantics, hit/miss tracking, and stampede collapse protection. It is the backing layer for authorization decisions, feature flag evaluations, and session lookups. Modules that need to cache anything from remote policy decisions to rendered templates reach for MLCache first.

## Observability

A programmable edge needs to explain itself. [Metrics](/docs/reference/scripted-modules/metrics) provides reusable instrumentation modeling and StatsD or DogStatsD line rendering that any module can consume. [Request Tracing](/docs/reference/scripted-modules/request-tracing) wires distributed trace context through requests: reading the native request ID, propagating trace headers, and rendering structured trace output. Metrics is the cross-module counting and timing surface. Request Tracing connects those measurements into end-to-end trace views.

## Operations and control

The final category is the operator interface: the tools that let you inspect, reconfigure, and diagnose scripted modules at runtime. [Control API](/docs/reference/scripted-modules/control-api) provides a unified internal control surface over flags, cache state, sessions, tracing configuration, and other runtime module state. [Health Gateway](/docs/reference/scripted-modules/health-gateway) aggregates health signals from multiple sources when the built-in native health checks are not enough for multi-source policy or aggregation needs. Together they give operators a way to interact with the scripted module layer without touching nginx config files.
