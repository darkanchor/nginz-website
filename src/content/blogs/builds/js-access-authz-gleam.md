---
title: js_access shipped today. We compiled Gleam to it.
description: njs PR #1044 landed access-phase scripting. We built a type-safe authorization DSL in Gleam that runs there — denying requests before proxy_pass ever opens a connection, with compile-time guarantees on every decision branch.
date: 2026-05-20
author: darkanchor team
---

Today upstream [njs PR #1044](https://github.com/nginx/njs/pull/1044) get shipped in the [njs 0.9.9 release](https://nginx.org/en/docs/njs/changes.html). `js_access` is now live — a new directive that puts JavaScript in nginx's ACCESS phase, before any content handler fires, before `proxy_pass` opens a connection to the upstream. For authorization, that changes everything. The right time to deny a request is before nginx commits resources to serving it.

We had an existing authorization module written in Gleam, running in the content phase via `js_content`. It worked. But content-phase authorization has a structural problem: by the time your handler runs, nginx has already buffered the request body, resolved the upstream, and opened a connection. If you're going to say no, you want to say it earlier.

So we compiled Gleam to the access phase on day one. Here's what the design looks like, and why the type system matters when you're targeting a bleeding-edge njs feature.

## The design: rules as first-class values

The core of the module is three types. `Decision` is either `Allow` or `Deny(status, reason)` — a single type flows through every rule, no exceptions, no side channels. `Context` holds the structured request state: method, path, headers, claims, query, and body. And `Rule` is simply `fn(Context) -> Decision`.

That last one is the design's load-bearing wall. A rule is a function — not a config string, not a regex, not a DSL parsed at runtime. A function that takes structured context and returns a decision. That means rules compose with ordinary function combinators: `all_of` short-circuits on the first `Deny`, `any_of` on the first `Allow`, `not_` inverts etc.

The Gleam compiler enforces exhaustiveness on every `case decision { Allow -> ... Deny -> ... }` statement. If a handler forgets a branch, the build fails. That guarantee turns out to matter most precisely where you'd least want to discover a gap — at the access phase, where a missing branch means a silent fallthrough to the content handler.

<style>
.highlight-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4);
  margin: var(--sp-5) 0;
}
.highlight-box {
  border: 1px solid var(--color-border);
  border-radius: 6px; padding: var(--sp-4);
  background: var(--color-bg-sunken);
}
.highlight-box .hl-label {
  font-size: var(--text-xs); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--color-text-tertiary); margin-bottom: var(--sp-2);
}
.highlight-box .hl-title {
  font-size: var(--text-base); font-weight: 700; color: var(--color-accent-text);
  margin-bottom: var(--sp-2); letter-spacing: -0.02em;
}
.highlight-box .hl-body {
  font-size: var(--text-sm); color: var(--color-text-secondary); line-height: 1.6;
}
.highlight-box code {
  font-size: var(--text-xs); background: var(--color-bg-code-block, var(--color-bg));
  border: 1px solid var(--color-border-subtle); border-radius: 3px; padding: 1px 5px;
}
</style>

<div class="highlight-grid">
<div class="highlight-box">
<div class="hl-label">With the Gleam DSL</div>
<div class="hl-title">Rules are values. The compiler checks your work.</div>
<div class="hl-body">Every rule is <code>fn(Context) &rarr; Decision</code>. Compose with <code>all_of</code> / <code>any_of</code> / <code>not_</code>. The Gleam compiler enforces exhaustiveness — every <code>Decision</code> branch must be handled, or the build fails. Unit-test rules as pure functions. No nginx required.</div>
</div>
<div class="highlight-box">
<div class="hl-label">Without it</div>
<div class="hl-title">Ad-hoc functions. Runtime surprises in production.</div>
<div class="hl-body">Each handler is a custom JavaScript function. Composition means manual nesting. A missing <code>else</code> or unhandled rejection falls through to allow. The njs VM won't tell you about the gap — your users will.</div>
</div>
</div>

The type safety isn't theoretical. While building the access-phase adapters, the Gleam compiler caught two exhaustiveness errors where a policy branch would have silently fallen through to `js_content`. In a JavaScript-native implementation, those failures would be runtime surprises. In Gleam, they're build failures.

## The access-phase adapter: same DSL, earlier phase

The jump from content phase to access phase required exactly one new function: an adapter that translates a `Decision` into access-phase signaling.

<style>
.gap-callout {
  background: linear-gradient(135deg, #2A404A 0%, #3A5A6A 100%);
  border-radius: 8px; padding: var(--sp-4) var(--sp-5);
  display: flex; align-items: center; gap: var(--sp-5);
  margin: var(--sp-5) 0;
}
.gap-big {
  font-size: 13px; font-weight: 700; letter-spacing: 0.02em;
  color: #99DDCC; line-height: 1.5; flex-shrink: 0;
  font-family: var(--font-mono, monospace); white-space: nowrap;
}
.gap-body { }
.gap-title {
  font-size: 15px; font-weight: 700; color: #fff; letter-spacing: -0.02em; margin-bottom: var(--sp-1);
}
.gap-sub {
  font-size: var(--text-sm); color: rgba(255,255,255,0.82); line-height: 1.6;
}
.gap-sub code {
  color: rgba(255,255,255,0.92);
  background: none;
  padding: 0;
  font-size: 0.9em;
}
</style>

<div class="gap-callout">
  <div class="gap-big">content phase<br>→ access phase</div>
  <div class="gap-body">
    <div class="gap-title">One DSL, two signal contracts.</div>
    <div class="gap-sub">In <code>js_content</code>, allow = <code>r.return(204)</code>. In <code>js_access</code>, allow = return nothing. nginx sees a normal return and advances to the content phase. The policy DSL doesn't change — only the adapter that sits between <code>Decision</code> and the nginx wire.</div>
  </div>
</div>

Allow is a no-op — return nothing, let nginx proceed to `js_content` or `proxy_pass`. Deny calls `r.return(status)` immediately, before any upstream connection opens. The policy DSL is unchanged. It's the same `Rule = fn(Context) -> Decision`. The only thing that differs is where you wire the decision — and in the access phase, you don't wire allow at all.

Here's the access-phase handler for a synchronous method gate — structurally identical to its content-phase counterpart, with exactly one line changed:

```gleam
fn access_check(r: HTTPRequest) -> Nil {
  let ctx = context_from_request(r)
  let rules = [policy.method_in(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])]
  case policy.evaluate(ctx, rules) {
    Allow -> Nil                        // access phase: return nothing
    Deny(status, reason) -> {
      let _ = http.log(r, "authz: access denied — " <> reason)
      http.return_code(r, status)
    }
  }
}
```

## Body-aware policies, fail-closed

One of the things `js_access` unlocks that content-phase handlers couldn't practically do is reading the request body before the upstream. The new njs API exposes `readRequestJSON()` and `readRequestForm()` — both available in the access phase, both asynchronous.

We built two async access-phase handlers that read the body, extract named fields, and apply policy:

```gleam
fn access_json_check(r: HTTPRequest) -> Promise(Nil) {
  case configured_body_policy(r, "json") {
    None -> promise.resolve(Nil)        // config error already returned 500
    Some(#(field_names, required)) ->
      http.read_request_json(r)
      |> promise.await(fn(json_obj) {
        let body_dict = body.from_json(json_obj, field_names)
        let ctx = Context(..context_from_request(r), body: body_dict)
        policy.evaluate(ctx, [policy.body_param_present(required)])
        |> apply_access_decision(r, _, "authz: access json denied — ")
      })
      |> promise.rescue(fn(_) {
        http.return_code(r, 400)        // malformed body → fail closed
        Nil
      })
  }
}
```

Three edges are covered by design here. First, if `$authz_body_fields` and `$authz_body_required` aren't coherent in the nginx config, the handler returns 500 — no silent fallthrough. Second, if `readRequestJSON()` rejects (malformed input, wrong Content-Type), the `promise.rescue` path returns 400 — fail closed, not fail open. Third, the Gleam compiler confirms at build time that both the `None` (config error) and `Some` (normal) branches are handled.

The form-body adapter is structurally identical. The nginx config tells the handler which fields to look for via two variables — `$authz_body_fields` (comma-separated field names) and `$authz_body_required` (the one that must be present). The Gleam code validates the coherence of those variables before touching the request body.

## What this unlocks

The access phase changes the economics of authorization in nginx. A content-phase deny still costs a connection to the upstream. An access-phase deny costs nothing — nginx returns the status code before it resolves a backend.

More importantly, the policy DSL now spans both phases. A rule written once — `claim_contains_one_of("role", ["admin", "support"])` — works in a content-phase handler behind `auth_request`, in an access-phase handler before `proxy_pass`, or in both. The type system doesn't care where the function runs. It only cares that every `Decision` branch resolves to a concrete status code or a pass-through.

86 unit tests cover the rules, combinators, and async evaluation paths. All of them run without nginx. Rules are pure functions; `evaluate` is a fold; the only external dependencies are the njs HTTP APIs, and those are mocked at the adapter boundary.

## Adapting to a new JS runtime

Gleam compiles to JavaScript. The njs runtime is a JavaScript engine (QuickJS) embedded in nginx. Matching Gleam's output to QuickJS required exactly one accommodation: Gleam's standard library uses `globalThis` in a few places, and recent njs builds expose that. Everything else — closures, promises, pattern matching, the `|>` pipe operator — Just Works.

The compiled output is a standard njs bundle. nginx loads it via `js_import` and has no visibility into the Gleam source. The type safety and composability are entirely build-time properties. At runtime, it's just JavaScript.

<style>
.lessons-box {
  background: linear-gradient(135deg, #2A404A 0%, #3A5A6A 100%);
  border-radius: 8px; padding: var(--sp-5);
  margin: var(--sp-5) 0;
  font-size: var(--text-sm); line-height: 1.7; color: rgba(255,255,255,0.88);
}
.lessons-box h4 {
  font-size: var(--text-base); font-weight: 700; color: #fff;
  margin: 0 0 var(--sp-3); letter-spacing: -0.02em;
}
.lessons-box strong { color: #fff; }
.lessons-row { display: flex; align-items: flex-start; gap: var(--sp-3); margin-bottom: var(--sp-2); }
.lessons-row:last-child { margin-bottom: 0; }
.lessons-icon { flex-shrink: 0; font-size: 17px; line-height: 1.65; }
</style>

<div class="lessons-box">
  <h4>What to take away</h4>
  <div class="lessons-row">
    <div class="lessons-icon">⚡</div>
    <div><strong>Access phase &gt; content phase for authorization.</strong> A deny before <code>proxy_pass</code> connects costs nothing. A deny in the content phase already paid for the upstream connection and body buffering. <code>js_access</code> makes the right phase programmable.</div>
  </div>
  <div class="lessons-row">
    <div class="lessons-icon">🧩</div>
    <div><strong>Rules as functions compose better than config strings.</strong> <code>all_of</code>, <code>any_of</code>, <code>not_</code> work because rules are values. The Gleam compiler guarantees every branch is handled. Unit-test policy trees without standing up nginx.</div>
  </div>
  <div class="lessons-row">
    <div class="lessons-icon">🛡️</div>
    <div><strong>Fail closed at every boundary.</strong> Malformed JSON → 400. Missing config → 500. Promise rejection → 400. An access gate that falls through to allow on a parse error isn't a gate — and the type system makes it impossible to forget the error path.</div>
  </div>
</div>

That last point is worth sitting with. The Gleam compiler rejected two handler drafts where a policy branch would have silently fallen through to the content phase. Those were not theoretical gaps — they were real edge cases in the body-reading adapters that would have become production incidents. In a dynamically-typed njs handler, they would have gone live. In Gleam, they were build failures.

<style>
.next-post {
  background: var(--color-bg-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px; padding: var(--sp-4) var(--sp-5);
  display: flex; align-items: center; gap: var(--sp-4);
  margin-top: var(--sp-8);
}
.next-post .arrow-icon {
  flex-shrink: 0;
  width: 32px; height: 32px;
  background: #99DDCC; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #2A404A; font-size: 16px; font-weight: 700;
}
.next-post .next-text { font-size: var(--text-sm); color: var(--color-text-secondary); line-height: 1.6; }
.next-post .next-text strong { color: var(--color-accent-text); }
</style>

<div class="next-post">
  <div class="arrow-icon">→</div>
  <div class="next-text">
    <strong>Coming post:</strong> the full policy DSL. Today we showed two access-phase handlers. The module behind them spans JWT claims, OIDC identity, WAF signals, nftset facts, session cookies, and remote OPA decisions — all through the same <code>fn(Context) &rarr; Decision</code> interface, all type-checked at build time, all composable with <code>all_of</code> and <code>any_of</code>.
  </div>
</div>
