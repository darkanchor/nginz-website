---
title: nginz-njs
license: Apache-2.0
category: Policy Layer
tagline: Scripted policy layer for nginx njs. Compose authorization, feature flags, and workflow orchestration — testable, reusable, no second runtime.
---

# nginz-njs

## The concern

nginx config is a great language for describing a static routing topology. It is not a great language for expressing per-request decisions. When your access control depends on who the user is, what role they have, what feature flags are active, and what the current session says — you can't express that in `if` directives. You need real logic.

Here are the situations teams face when they try to push policy into nginx:

**Your API has three user tiers.** Free users can call five endpoints. Pro users can call twenty. Admin users can call everything, but only during business hours. You start with `if ($tier = "free")` blocks in your nginx config. By the third tier, you have nested conditionals that nobody wants to touch. Adding a fourth tier means rewriting every location block. A new engineer asks "which endpoints can free users actually hit?" and the answer is "read the config" — a config that's now 400 lines of `if` statements spread across eight locations.

**You need to call an external policy service for some requests.** Not all requests — only the ones hitting `/admin`, and only when the user's JWT was issued more than an hour ago. You want to cache the result so you don't call the policy service on every request. Stock nginx has `auth_request`, which calls one external endpoint per request. It doesn't cache. It doesn't conditionally skip. It's all-or-nothing, per-request, no caching. You end up building a sidecar service that does the caching and the conditioning, and now you have two things to deploy and monitor.

**You're running an A/B test on your checkout flow.** Half your users should see the new flow, half the old. But "half" means the same user always sees the same flow — you can't have a customer see the new checkout on Monday and the old one on Tuesday. The split needs to be deterministic per user, not random per request. Stock nginx's `split_clients` is random per request. You'd need to hash the user ID consistently, but nginx config has no hashing directive that maps to a percentage range. You write a Lua script. Now you're maintaining a Lua runtime inside nginx.

**Your frontend team needs the API response in a different shape.** The backend returns forty fields. The mobile app needs six of them, renamed, with a couple of computed fields added. The backend team says "we're not building a BFF layer — that's an API gateway concern." You could add an API gateway. Or you could add a Node service that transforms responses. Either way, you're deploying and operating another service for what is fundamentally a field-mapping problem.

**You need to sign and deliver webhooks when an order ships.** The webhook delivery needs retries with backoff, different signatures per endpoint, and a way to verify callbacks. You could build this into your application — but then your application is in the webhook delivery business, with retry queues, signature management, and callback verification. Or you could pay for a webhook service. Or you could let nginx handle it: your application sets a header, nginx signs and delivers.

**Multiple teams share the same nginx instance.** Each team has its own auth logic, its own feature flags, its own response transforms. You try to keep their configs separate with `include` directives, but auth rules reference flags, flags reference sessions, and soon the includes are circular. There's no module boundary in nginx config — no import, no namespace, no way to say "this block of logic belongs to the payment team and only depends on these three variables."

The common thread: **nginx config can route traffic. It can't make decisions about traffic.** For that, you need programmable logic. And the available options — Lua in OpenResty, JavaScript in njs — give you a scripting surface without giving you a way to structure what you build on top of it.

## What stock nginx + njs is missing

nginx's njs engine is genuinely capable. It exposes request hooks, body filters, subrequests, `ngx.fetch()` for outbound HTTP, a shared dictionary for cross-request state, and stream APIs for response manipulation. The runtime is QuickJS — small, fast, ES2020-compatible.

What njs doesn't give you is a way to **organize** logic so it stays maintainable past the first few scripts:

- **No type safety.** A typo in a property name — `req.method` vs `req.methd` — is a runtime undefined, not a compile-time error. In a language where every value is `any`, you catch bugs in production.
- **No composability model.** How do you combine three auth rules into one policy? How do you chain two response transforms? How do you run workflow steps in parallel and merge the results? njs gives you functions. It doesn't give you combinators.
- **No package boundaries.** Every script that calls `ngx.fetch()` owns its own HTTP logic — timeouts, retries, header parsing. If three scripts need to make outbound calls, the fetch logic exists in three places, slightly different in each.
- **No immutability guarantees.** The shared dictionary is mutable by any script at any time. The request object is mutable. Concurrent access by multiple request handlers to the same shared state is a race condition waiting to happen.

OpenResty with Lua is the established alternative. It works. But it means running a LuaJIT VM inside every nginx worker — a second runtime, a second garbage collector, a second set of dependencies. And Lua's dynamism gives you the same structural problems as plain JavaScript: no types, no composability primitives, no module boundaries beyond `require`.

## Our approach

nginz-njs provides 13 scripted modules that run in nginx's built-in njs engine. No second runtime. No LuaJIT. No custom binary. You add them via `js_import` like any njs module.

Each module has **two surfaces**. The first is a library of pure, typed functions — authorization rules, feature flag evaluators, workflow runners, response transformers. These functions are ordinary code you can import, unit-test, and compose. The second surface is an njs adapter — a thin `exports()` function that wires the library into nginx's module system. The library is the product. The adapter is the last mile.

This design means modules compose with each other as libraries, not as isolated scripts. `authz` depends on `http_client` for remote policy calls — it imports the module, calls the function, gets a typed result. `workflow` depends on `http_client` for subrequests — same import, same typed interface. `session` provides identity facts to both `authz` and `feature_flags` — a single session lookup feeds every module that needs it. `mlcache` provides a shared cache layer that any module can use. You're not wiring together standalone scripts. You're composing packages.

Let's walk through how this works in practice.

### Authorization as pure functions

An authorization rule is a function that takes a request context and returns either `Allow` or `Deny` with a reason. You define rules for individual checks:

```gleam
// Only allow GET and POST
let method_rule = method_in(["GET", "POST"])

// Only allow paths under /api
let path_rule = path_prefix("/api")

// Require admin role from JWT claims
let role_rule = has_claim("role", "admin")
```

You combine them with combinators:

```gleam
let api_policy = all_of([method_rule, path_rule, role_rule])
```

`all_of` returns `Allow` only if every rule passes. `any_of` returns `Allow` if any rule passes. `evaluate` runs rules in order until one returns `Deny`, then stops. Every rule is a pure function — no side effects, no hidden state. You can unit-test each rule independently. You can unit-test the composed policy. When you change a rule, you know exactly what it affects because the dependency is explicit in the composition.

For remote policy decisions — calling an OPA server, checking an external entitlement service — the rule uses `http_client` to make the call, then caches the result via `mlcache` so subsequent requests from the same user skip the network hop.

### Feature flags with deterministic bucketing

When you roll out a feature to 20% of users, you need the same user to always fall on the same side of the split. The feature flag module hashes the user identity to a stable bucket. If user `alice` has bucket 15 and the rollout threshold is 20, alice always gets the feature. If you raise the threshold to 50, alice still gets it. If you lower it to 10, alice stops getting it. But alice never bounces between having the feature and not having it on consecutive requests.

The bucketing is a pure function. It takes an identity string, a flag key, and a percentage. It returns a boolean. No external service, no database, no shared state that can drift between workers:

```gleam
let is_enabled = feature_flags.is_enabled("new_checkout", user_id, 20.0)
```

You can force specific users on or off regardless of percentage — useful for internal testing. You can read flag state from nginx's shared dictionary for runtime toggles without config changes. And the output feeds directly into nginx variables via `js_set`, so your routing logic can branch on flag state.

### Workflow orchestration that reads like a description

When an API request needs data from three backends — user profile, feature flags, and entitlements — you describe the pipeline, not the execution order:

```gleam
let pipeline = workflow.parallel([
  fetch_step("/internal/profile", [header("x-user-id", user_id)]),
  fetch_step("/internal/features", [header("x-user-id", user_id)]),
  fetch_step("/internal/entitlements", [header("x-user-id", user_id)]),
])
|> workflow.with_timeout(2000)
|> workflow.with_merge(fn(steps) { merge_responses(steps) })
```

The workflow module runs the three fetches in parallel, enforces a 2-second total timeout, and merges the results with your merge function. If one step fails, you can configure a fallback value. If you need sequential execution — the output of step one feeds step two — use `chain` instead of `parallel`. Both support retries with backoff, per-step timeouts, and degraded-mode responses.

The steps can be subrequests to internal nginx locations (no network hop, same worker) or external HTTP calls through `http_client` (full `ngx.fetch()` with TLS). The workflow module doesn't care which — it composes both the same way.

### Response transforms without a separate service

Your backend returns a verbose JSON response. The mobile client needs a subset. You define a transform plan:

```gleam
let plan = transform.plan()
  |> transform.keep(["id", "title", "summary", "author"])
  |> transform.rename("summary", "description")
  |> transform.drop(["internal_notes", "draft"])
  |> transform.when_status(200)
```

The transform module applies this plan in the body filter — nginx receives the full upstream response, reshapes it, and sends the trimmed version to the client. The backend never knows the transform exists. The mobile team gets exactly the fields they need without a BFF layer, an API gateway, or a separate service.

### Session management that feeds every module

The session module models cookies as typed values with expiration, renewal, and a shared-dictionary store. When a request arrives, the session module reads the session cookie, validates it, and extracts the session data into typed fields. Those fields are available to `authz` (for identity-based rules), `feature_flags` (for per-user flag bucketing), and `mlcache` (for session-scoped cache keys).

One session lookup. Every module that needs identity data consumes the same result. No module re-parses the cookie. No module manages its own session state. The session module is the single source of truth.

### Module catalog

Every module has a clear public interface. Follow the links for full documentation, config examples, and composability guidance.

**Foundation** — the typed HTTP client that every other module builds on.

- [HTTP Client](/docs/reference/scripted-modules/http-client) — typed wrapper around `ngx.fetch()` with input validation, timeout control, policy hooks, and middleware support

**Policy & access** — decide who can do what, at the edge, before traffic reaches your application.

- [Authorization](/docs/reference/scripted-modules/authz) — composable rules for method, path, header, JWT claim, remote OPA, and caching; rules combine with `all_of` and `any_of`
- [Feature Flags](/docs/reference/scripted-modules/feature-flags) — deterministic per-user bucketing for gradual rollouts and A/B testing
- [Session](/docs/reference/scripted-modules/session) — cookie lifecycle, shared-dictionary store, and identity facts consumed by authz and feature flags

**Orchestration** — build multi-step request pipelines that compose.

- [Workflow](/docs/reference/scripted-modules/workflow) — parallel and sequential subrequest orchestration with retry, timeout, fallback, and merge strategies
- [Webhook](/docs/reference/scripted-modules/webhook) — signed delivery composition over HTTP Client, callback verification, and reliable outbound messaging

**Data shaping** — transform responses at the edge, before the client sees them.

- [Response Transform](/docs/reference/scripted-modules/response-transform) — plan-based JSON field masking, dropping, renaming, and status-conditional operations
- [Response Templating](/docs/reference/scripted-modules/response-templating) — generate lightweight synthetic responses from request and runtime facts

**State & caching** — a shared cache layer for every module that needs cross-request state.

- [MLCache](/docs/reference/scripted-modules/mlcache) — two-level cache with stale-while-revalidate, hit/miss tracking, and stampede collapse protection

**Observability** — make the programmable edge explain itself.

- [Metrics](/docs/reference/scripted-modules/metrics) — reusable instrumentation modeling and StatsD/DogStatsD line rendering consumed by other modules
- [Request Tracing](/docs/reference/scripted-modules/request-tracing) — distributed trace context: request ID → propagation headers → structured trace output

**Operations** — inspect and control scripted modules at runtime without touching config files.

- [Control API](/docs/reference/scripted-modules/control-api) — unified operator surface over flags, cache, sessions, and tracing configuration
- [Health Gateway](/docs/reference/scripted-modules/health-gateway) — multi-source health aggregation for when native health checks aren't enough

## Why we author modules in Gleam

We author modules in Gleam, a functional language that compiles to JavaScript. The compiled output runs in njs — you don't need Gleam installed on your nginx host. The modules ship as plain JavaScript files loaded via `js_import`. Gleam is our authoring tool. Here's what it gives us, and what that means for you.

**Type safety at compile time.** An authorization rule that checks `ctx.methd` instead of `ctx.method` doesn't make it to production — the compiler catches it. A feature flag function that expects a float but receives a string fails at build time, not when a user gets the wrong experience. A workflow step that references a response field that doesn't exist is a compiler error. In policy code, where bugs mean wrong access decisions, this matters.

**Composability by default.** Gleam is a functional language. Functions are the primary unit of abstraction. Combining them is natural — `all_of([rule1, rule2, rule3])` is a function call that returns a new rule, not a framework pattern you need to learn. You build policies the way you'd build a SQL query: small, clear pieces combined with well-understood operators.

**Immutability everywhere.** In Gleam, values don't change after they're created. A session object passed to `authz` is the same object regardless of what else happens during the request. No shared mutable state between modules. No race conditions from concurrent request handlers writing to the same variable. What you test is what runs in production — because nothing can mutate behind your back.

**Package management that works.** Every nginz-njs module is an independent Gleam package with versioned dependencies. `authz` declares its dependency on `http_client` in a manifest file. `workflow` does the same. When you update `http_client` to v1.2.0, you know exactly which modules are affected. This is standard practice for application code. We're bringing it to nginx policy — so your edge logic benefits from the same dependency management as your backend code.

**One language, one toolchain.** Every module — auth, flags, workflows, transforms, caching, metrics, tracing — is written in the same language, built with the same tool, tested with the same test runner. When a new team member learns how to read the authz module, they know how to read the workflow module. There's no mix of Lua and JavaScript and C and config logic. One surface to learn.

Gleam is how we build reliable, composable policy logic. The result is nginx modules that behave predictably, compose cleanly, and don't surprise you in production.
