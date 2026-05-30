---
title: Another milestone reached, perf regressed
description: Adding auth, ratelimiting, metrics, and cost accounting to our AI gateway introduced a measurable performance tax. Two rounds of profiling, a cache-line audit, and a shared-memory restructuring later, the tax mostly disappeared — and we learned something about what a microbenchmark can hide.
date: 2026-05-30
author: darkanchor team
---

My marketing officer keeps telling me my blogs are too technical. She's right. Here's another one.

When you add four modules to a request path, you expect it to get slower. We did not expect it to get 16% slower. Not on the happy path — the native OpenAI non-streaming route, the one where ratelimiting says yes, metrics labels are off, cost accounting records without persisting, and auth completes in a single credential lookup. That path should cost almost nothing.

It didn't. And the data pointing at the cause was wrong.

This post is about the regression, the investigation that revealed our profiling fixture was hiding the real problem, and the two rounds of changes — hot-path reduction and memory layout restructuring — that brought the tax back down. Along the way we learned something about cache lines, shared memory, and why benchmarking a single nginx worker is not the same as benchmarking nginx.

## The integration delta

The latest integration push wired four modules into the active request path: auth credential resolution, per-request metrics counter updates, ratelimit admission, and cost accounting. Before this integration, the "likely" stack — proxy plus all four support modules — was essentially flat against proxy-only. The modules were scaffolds. The code was there but most of it wasn't executing real logic.

After integration, every module does real work on every request. The initial remeasurement on our standard profile — `worker_processes 1`, `c=32`, `openai-nonstream-small` — told this story:

<style>
.data-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); margin: var(--sp-4) 0; }
.data-table th { background: var(--color-bg-sunken); color: var(--color-accent-text); font-weight: 600; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.05em; padding: var(--sp-2) var(--sp-3); text-align: right; border-bottom: 2px solid var(--color-border); }
.data-table th:first-child { text-align: left; }
.data-table td { padding: var(--sp-2) var(--sp-3); text-align: right; border-bottom: 1px solid var(--color-border-subtle); font-variant-numeric: tabular-nums; }
.data-table td:first-child { text-align: left; color: var(--color-accent-text); font-weight: 500; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--color-bg-sunken); }
.delta-red { color: #cf222e; font-weight: 700; }
</style>

<table class="data-table">
<thead><tr><th>Stack</th><th>RPS (c=32)</th><th>p99</th><th>Instructions / req</th><th>Cache miss rate</th></tr></thead>
<tbody>
<tr><td>proxy-only</td><td>8,694</td><td>8.72 ms</td><td>92,700</td><td>4.28%</td></tr>
<tr><td>likely (proxy + auth + metrics + ratelimit + cost)</td><td>7,643</td><td>11.10 ms</td><td>102,476</td><td>5.24%</td></tr>
</tbody>
</table>

<div style="text-align:center;margin:var(--sp-4) 0;">
  <span style="display:inline-block;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:4px;padding:var(--sp-2) var(--sp-5);font-size:var(--text-base);font-weight:700;">
    <span class="delta-red">−12.1% RPS</span> &nbsp;·&nbsp; <span class="delta-red">+10.6% instructions</span> &nbsp;·&nbsp; <span class="delta-red">+0.96pp cache misses</span>
  </span>
</div>

Twelve percent throughput drop. Ten percent more instructions per request. The cache miss rate ticked up by nearly a full percentage point. This wasn't catastrophic — the gateway still served 7,600 requests per second on a 2009-era i7-860. But it was a visible service-level tax on a path that should be as close to free as the product surface allows.

## The single-worker blind spot

The initial numbers above came from `worker_processes 1`. That's the default in our perf fixtures, and it's the natural baseline: one worker means no cross-worker contention, no scheduler noise, clean counter attribution. Every microbenchmark instinct says to pin to one worker.

But nginx in production runs multiple workers. And our service modules — ratelimit and metrics — use shared memory zones. When every worker is the only worker, there is no contention. The shared-memory path is free.

The first clue that we were measuring the wrong thing came from the perf-stat counters at `c=32` under single-worker:

<table class="data-table">
<thead><tr><th>Metric</th><th>Proxy-only</th><th>Likely</th><th>Δ</th></tr></thead>
<tbody>
<tr><td>Instructions / req</td><td>92,700</td><td>102,476</td><td>+10.55%</td></tr>
<tr><td>Cycles / req</td><td>159,012</td><td>168,294</td><td>+5.84%</td></tr>
<tr><td>Cache refs / req</td><td>—</td><td>—</td><td>—</td></tr>
<tr><td>Cache misses / req</td><td>—</td><td>—</td><td>—</td></tr>
</tbody>
</table>

The instruction delta explained roughly half the throughput drop. The other half was unaccounted for — the cycles gap was smaller than the throughput gap, which is unusual. Something else was dragging throughput down, and the single-worker fixture wasn't surfacing it.

We switched the fixtures to `worker_processes auto` — on this 8-logical-CPU machine, that means 8 workers sharing the same shared memory zones. Then we reran the same `openai-nonstream-small` scenario at `c=32`.

<style>
.big-compare {
  display: grid; grid-template-columns: 1fr auto 1fr; gap: var(--sp-3); align-items: center;
  background: var(--color-bg-sunken); border: 1px solid var(--color-border);
  border-radius: 8px; padding: var(--sp-5); margin: var(--sp-5) 0; text-align: center;
}
.big-compare .col { }
.big-compare .label {
  font-size: var(--text-xs); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--color-text-tertiary); margin-bottom: var(--sp-2);
}
.big-compare .val {
  font-size: 32px; font-weight: 900; letter-spacing: -0.04em; line-height: 1;
}
.big-compare .val.l { color: var(--color-accent-text); }
.big-compare .val.r { color: #cf222e; }
.big-compare .sub { font-size: var(--text-xs); color: var(--color-text-secondary); margin-top: var(--sp-1); }
.big-compare .sep { font-size: 28px; color: var(--color-border); font-weight: 300; }
</style>

<div class="big-compare">
<div class="col">
  <div class="label">Single-worker likely vs baseline</div>
  <div class="val l">−12.1%</div>
  <div class="sub">RPS gap at c=32</div>
</div>
<div class="sep">→</div>
<div class="col">
  <div class="label">8-worker likely vs baseline</div>
  <div class="val r">−20.2%</div>
  <div class="sub">RPS gap at c=32</div>
</div>
</div>

The gap nearly doubled. And the counter breakdown told the real story:

<table class="data-table">
<thead><tr><th>Metric</th><th>Single-worker Δ</th><th>8-worker Δ</th><th>What changed</th></tr></thead>
<tbody>
<tr><td>Instructions / req</td><td>+10.55%</td><td>+7.96%</td><td>Instructions stayed in the same neighborhood</td></tr>
<tr><td>Cycles / req</td><td>+5.84%</td><td>+16.26%</td><td>Stall cycles appeared</td></tr>
<tr><td>Cache refs / req</td><td>—</td><td>+17.70%</td><td>Shared-memory touched cache lines only visible with multiple workers</td></tr>
<tr><td>Cache misses / req</td><td>—</td><td>+54.86%</td><td>Cross-worker cache-line invalidation dominates</td></tr>
</tbody>
</table>

The instruction tax was real but modest — about 8%. The real penalty was cache behavior: 55% more cache misses per request, 32% higher cache miss rate. IPC dropped from 0.506 to 0.470. Eight workers simultaneously touching shared-memory zones meant cache lines bouncing between cores on every request.

This was the single-worker blind spot. The single-worker fixture told us we had an instruction problem. The multi-worker fixture told us we had a memory layout problem. They were both right — we had both — but the memory layout problem was twice as expensive and invisible in the baseline fixture.

## Round 1: hot-path instruction reduction

Before we rearchitected the shared-memory layout, we went after the low-hanging instructions. Three findings from audit:

**Redundant header-list scans in auth.** `upsert_request_header` was calling `clear_request_header_slot` (which refreshes known header pointers), then calling `refresh_known_request_header_slots` again after appending. Two complete O(n) scans of the request header list per upsert. On the common bearer-token path, we cleared the wrong header first, then the right one — three scans where one would suffice.

**Full-array linear scans in ratelimit.** The ratelimit module's `getOrCreateEntry` function scanned all 4,096 entries of the shared-memory ledger on every ACCESS-phase lookup — even when only one active key existed. Each iteration: hash comparison, null check, branch. About 20,000–28,000 instructions per access, and 3,000 cache lines touched per scan. The 4,096-entry array occupies 196 KB of shared memory.

**Observable struct copies multiplied.** `llm-proxy`'s `observe()` function copies a 216-byte struct (19 fields) to every caller via C ABI hidden-pointer return. The metrics module called it once. The cost module called it independently. The ratelimit module called it on the LOG path. Three copies of the same struct per request.

We applied targeted fixes: collapsed the header-list scan chain into one, replaced the 4,096-entry ratelimit scan with a bounded `[0, entry_count)` prefix scan, and added lightweight single-field accessor exports so downstream modules could read one field without copying 216 bytes.

The total: roughly 20,000–28,000 fewer instructions per request. Primarily from the ratelimit bounded scan.

But the multi-worker rerun showed something unexpected. Instructions per request fell from 96,057 to 94,630 — a 1.5% drop, not the 20% the analysis predicted. The throughput gap at `c=32` went from −20.2% to −0.98%, which was good. The cache miss per request gap went from +54.86% to −3.74%, which was better. But the instruction count barely moved.

The bounded scan was working — cache misses proved it — but something else was inflating the instruction count: `@intFromBool` used in branchless counter updates. The `setz → movzx → add` dependency chain produces more instructions than a `cmp → jmp → inc` pattern on well-predicted branches. On the steady-state benchmark where every branch is perfectly predictable, branchless was slower. We reverted to branched counter updates and kept the precomputed booleans.

But the real lesson was that instruction shaving was a side story. The cache behavior was the main event, and it needed a different kind of fix.

## Round 2: memory layout restructuring

The multi-worker cache miss pattern pointed to two modules: ratelimit and metrics. Both use shared-memory zones. Both touch those zones on every request. When eight workers share a cache-coherent view of the same physical pages, every write to a shared cache line invalidates that line in every other worker's L1 and L2.

Two problems, two structural fixes.

### Ratelimit: cache-line false sharing

The ratelimit store was a single `extern struct` with a header and a 4,096-entry array:

```
┌─────────────────────────────────────┐
│ initialized │ entry_count │ ...     │  ← header shares a cache line with entry[0]
├─────────────────────────────────────┤
│ entry[0]    │ 48 bytes              │  ← adjacent entries share cache lines
├─────────────────────────────────────┤
│ entry[1]    │ 48 bytes              │
├─────────────────────────────────────┤
│ ...         │                       │
└─────────────────────────────────────┘
```

Two problems. First, the store header (including `entry_count`) and `entry[0]` occupied the same 64-byte cache line. Every write to `entry[0]` — the most common slot when only one active key exists — invalidated the header for all other workers. Workers reading `entry_count` took a cache miss every time someone touched `entry[0]`.

Second, each `LlmRateLimitEntry` was 48 bytes. Two adjacent entries fit within 96 bytes — meaning they spanned two cache lines, and writes to entry N could invalidate entry N+1 for a neighboring worker.

The fix: pad `LlmRateLimitEntry` to exactly 64 bytes with a `_pad: [16]u8` field. Pad the store header to 64 bytes with `_header_pad: [40]u8`. Add comptime assertions:

```zig
const LlmRateLimitEntry = extern struct {
    key_hash: u64,
    req_count: u64,
    token_count: u64,
    window_minute: i64,
    last_used: i64,
    cooldown_until_ms: u64,
    _pad: [16]u8,            // pad to 64 bytes — one cache line
};

comptime { std.debug.assert(@sizeOf(LlmRateLimitEntry) == 64); }

const llm_ratelimit_store = extern struct {
    initialized: ngx_flag_t,
    store_size: usize,
    entry_count: ngx_uint_t,
    _header_pad: [40]u8,     // pad header to 64 bytes
    entries: [MAX_ENTRIES]LlmRateLimitEntry,
};

comptime {
    std.debug.assert(@offsetOf(llm_ratelimit_store, "entries") == 64);
}
```

Now the header occupies its own cache line, and each entry occupies exactly one. Workers writing to different entries never share a cache line. Workers reading the header never collide with workers writing to any entry.

### Metrics: per-worker slices, not a global lock

The metrics module had the same class of problem with a different shape. Every counter update — provider, auth status, outcome — took a global mutex. Eight workers, one lock, every request. The fix was the same idea applied to counters instead of entries: give each worker its own counter slice. Worker one writes to slice one, worker two to slice two, no lock required. The Prometheus export handler sums them up at scrape time — an O(worker_count) merge that costs nothing on the request path. The global lock still exists for the model and tenant label tables, but those are written once per new label value, not once per request.

We also added a safety catch while restructuring these layouts. When a shared-memory struct changes shape between nginx reloads — a field added, a size shifted — the old bytes in the zone no longer match the new code. The slab allocator won't warn you. It'll hand back a pointer and let you interpret the wrong layout. So we put a simple size check in every zone init: at startup, compare the stored struct size against the compile-time size. If they differ, refuse to load. One field, one assertion, no runtime cost. Not glamorous, but it prevents the worst kind of bug: the one that produces correct output while reading the wrong bytes.

### The result

The multi-worker rerun with the memory layout fixes:

<table class="data-table">
<thead><tr><th>Metric</th><th>Before (8-worker)</th><th>After (8-worker)</th><th>Δ</th></tr></thead>
<tbody>
<tr><td>Likely vs baseline RPS gap</td><td>−20.19%</td><td>−0.98%</td><td>19.21 pp improvement</td></tr>
<tr><td>Likely vs baseline p99 gap</td><td>+28.33%</td><td>−6.48%</td><td>Likely now faster at p99</td></tr>
<tr><td>Cache misses / req gap</td><td>+54.86%</td><td>−3.74%</td><td>Likely now fewer cache misses</td></tr>
<tr><td>Cache miss rate gap</td><td>+31.57%</td><td>−5.53%</td><td>Likely now lower miss rate</td></tr>
<tr><td>Instructions / req gap</td><td>+7.96%</td><td>+2.71%</td><td>Instruction tax nearly halved</td></tr>
</tbody>
</table>

The 16% regression that kicked off this investigation — at the realistic multi-worker deployment shape — is now essentially gone. The likely stack (proxy + auth + metrics + ratelimit + cost) is within 1% of proxy-only throughput at `c=32`, with fewer cache misses and lower tail latency. The instruction tax is down to 2.7%, which is the genuine per-request cost of credential selection, shm mutex acquisition (once per request, not once per counter), and cost calculation.

<div class="gap-callout">
  <div class="gap-emoji">📊</div>
  <div class="gap-body">
    <div class="gap-title">The gap didn't disappear — it moved to the right place.</div>
    <div class="gap-sub">The remaining ~2.7% instruction overhead is the honest cost of the feature set. Auth credential selection, rate-card lookup, cost calculation, and the one remaining shm mutex on the ACCESS path are real work. Cache-line false sharing and global lock contention were not — they were artifacts of how we laid out memory, not what we computed.</div>
  </div>
</div>

## Now we safely find out

A single node on modest hardware: 50–500 users is easy single-node territory, 500–2,000 users is still comfortable for normal bursty internal team usage, 2,000–5,000 users is reasonable with normal production discipline. Beyond 5,000, cluster for HA and headroom rather than because the gateway core is collapsing. For heavier mixes — more streaming, provider translation, large bodies — plan around a few hundred active users per node, then scale out. The gateway won't be your bottleneck. Provider quotas, upstream latency, and streaming duration usually dominate before raw gateway CPU does.

## What we take away

Three things.

**One: your profiling fixture is part of your performance profile.** `worker_processes 1` is a valid microbenchmark setting. It eliminates noise. It also eliminates the one thing that matters most for shared-memory modules: cache-line contention across workers. If your module touches shared memory, measure it with the worker count you'll deploy. The single-worker number is incomplete.

**Two: cache lines are the language of shared-memory performance.** Instruction count tells you how much work you're doing. Cache miss rate tells you how much of that work is waiting for memory. When the two metrics disagree — more instructions but higher throughput — check your layout. Padding a struct to 64 bytes is not superstition. It's the difference between a write that stays in the writing core's L1 and a write that invalidates eight other cores.

**Three: the honest tax is small and the dishonest tax is fixable.** After the layout work, the likely-stack overhead is ~2.7% instructions per request and a lower cache miss rate than proxy-only. That's the real cost of credential lookup, rate-card matching, and cost arithmetic — not an artifact of how we laid out bytes. The 16% regression was never a feature tax. It was a layout tax, and layout tax is fixable with a ruler.

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
    <div class="lessons-icon">🧪</div>
    <div><strong>Benchmark at production worker counts.</strong> A single-worker fixture is a microbenchmark. Shared-memory modules need multi-worker fixtures because cache-line invalidation across cores is the dominant cost that single-worker hides.</div>
  </div>
  <div class="lessons-row">
    <div class="lessons-icon">📏</div>
    <div><strong>Cache-line-align shared-memory structs.</strong> Pad entries to 64 bytes. Pad the header to its own line. Add comptime assertions. A struct that looks "wasteful" in a sizeof() printout is often faster because it doesn't make every core reload the same bytes.</div>
  </div>
  <div class="lessons-row">
    <div class="lessons-icon">🔒</div>
    <div><strong>Per-worker ownership beats per-operation locking.</strong> A global mutex on every counter increment is the obvious design. A per-worker slice with no lock is better by every metric — throughput, tail latency, cache pressure. Aggregate at scrape time, not at request time.</div>
  </div>
  <div class="lessons-row">
    <div class="lessons-icon">🛡️</div>
    <div><strong>Guard shared-memory layouts with size sentinels.</strong> A `store_size` field checked against `@sizeOf` at zone init catches layout changes before they become silent corruption. One field, one assertion, no runtime cost. Not glamorous, but it prevents the worst kind of bug: the one that produces correct output with wrong internal state.</div>
  </div>
</div>

The gateway is healthy. The tax is where it belongs. And the measurement infrastructure — multi-worker fixtures, cache-line-safe structs, size sentinels — is in place for the next feature wave.

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
    <strong>Coming post:</strong> the product alignment pass — 14 design topics we surfaced while writing the module docs. Dialect as a first-class dimension, translation discouraged by default, and why a gateway without first-party credential issuance is incomplete.
  </div>
</div>
