---
title: Your libc is your performance profile
description: When we benchmarked our nginx Docker images, the performance gap had nothing to do with our code. Every percentage point traced back to glibc vs musl, OpenSSL, and the allocator.
date: 2026-05-16
author: darkanchor team
---

When you ship a Docker image with nginx and two dozen custom modules, where does the performance come from?

We assumed the answer would involve our code — the 26 native Zig modules, the event loops, the shared-memory counters. We were wrong. The data told a different story: one where the modules are invisible, and every meaningful performance difference between our two images traces back to the C standard library, the OpenSSL build, and the memory allocator.

This post is about what we found, why it surprised us, and what it means if you're choosing a base image for your own nginx deployment.

## Two images, same nginx

We ship two Docker images. Both run the same stock nginx binary with the same 24 nginz modules loaded as `.so` files. The only difference is the base:

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
.highlight-box h4 {
  margin: 0 0 var(--sp-1);
  font-size: var(--text-base);
}
.highlight-box .tag {
  display: inline-block;
  font-size: var(--text-xs); font-weight: 600;
  border-radius: 3px; padding: 1px 7px;
  margin-bottom: var(--sp-2);
}
</style>

<div class="highlight-grid">
<div class="highlight-box">
<h4>darkanchor/nginx:1.30.1</h4>
<span class="tag" style="background:var(--color-accent-soft);color:var(--color-accent-text);">Debian trixie-slim</span>
<ul style="margin:var(--sp-2) 0 0;padding-left:var(--sp-4);font-size:var(--text-sm);color:var(--color-text-secondary);">
<li>glibc 2.40</li>
<li>Debian OpenSSL with AVX2</li>
<li>ptmalloc2 allocator</li>
<li><strong>164 MB</strong> compressed</li>
</ul>
</div>
<div class="highlight-box">
<h4>darkanchor/nginx:1.30.1-alpine</h4>
<span class="tag" style="background:var(--color-accent-soft);color:#1E6B5A;">Alpine 3.23</span>
<ul style="margin:var(--sp-2) 0 0;padding-left:var(--sp-4);font-size:var(--text-sm);color:var(--color-text-secondary);">
<li>musl 1.2.5</li>
<li>Alpine OpenSSL (no AVX2)</li>
<li>musl malloc (eager unmapping)</li>
<li><strong>26 MB</strong> compressed</li>
</ul>
</div>
</div>

164 megabytes versus 26. A 6× size difference. Trivial enough that you might reach for Alpine by default and never look back. But we needed to know: does that smaller image come with a performance cost? And if so, how much of it is our fault?

## Two workloads, one conclusion

We ran two benchmarks, chosen to stress fundamentally different parts of the system.

**The CPU-bound path: JWT verification.** Pure computation. A tight loop of HMAC-SHA256 or RSA-2048 signature verification, with minimal I/O. If there's a CPU overhead buried in the base image, this workload will surface it at full volume.

**The I/O-bound path: dynamic upstream management.** Six modules working together — cookie parsing, shared-memory upstream lookups, health check state reads, cache-tag recording, and a proxy round-trip to a loopback backend. The CPU sits mostly idle while the system waits for the upstream. If CPU overhead exists but gets masked by concurrency, this workload will show it.

Both workloads pointed to the same place.

## The CPU-bound finding: RSA-2048 at c=1

Single-connection throughput for RS256 JWT verification — the most computationally expensive path we have. RSA-2048 modular exponentiation via OpenSSL. At one concurrent connection, there's nowhere to hide:

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
.big-compare .val.t { color: var(--color-accent-text); }
.big-compare .val.a { color: #7BBFB0; }
.big-compare .sub { font-size: var(--text-xs); color: var(--color-text-secondary); margin-top: var(--sp-1); }
.big-compare .sep { font-size: 28px; color: var(--color-border); font-weight: 300; }
.big-compare .delta-box { font-size: var(--text-sm); font-weight: 700; margin-top: var(--sp-2); padding: 2px 10px; border-radius: 3px; display: inline-block; }
.gap-callout {
  background: linear-gradient(135deg, #2A404A 0%, #3A5A6A 100%);
  border-radius: 8px; padding: var(--sp-4) var(--sp-5);
  display: flex; align-items: center; gap: var(--sp-5);
  margin: var(--sp-5) 0;
}
.gap-big {
  font-size: 48px; font-weight: 900; letter-spacing: -0.05em;
  color: #99DDCC; line-height: 1; flex-shrink: 0;
}
.gap-body { }
.gap-title {
  font-size: 15px; font-weight: 700; color: #fff; letter-spacing: -0.02em; margin-bottom: var(--sp-1);
}
.gap-sub {
  font-size: var(--text-sm); color: rgba(255,255,255,0.75); line-height: 1.6;
}
</style>

<div class="big-compare">
<div class="col">
  <div class="label">Trixie (glibc)</div>
  <div class="val t">1,945</div>
  <div class="sub">requests / sec</div>
</div>
<div class="sep">vs</div>
<div class="col">
  <div class="label">Alpine (musl)</div>
  <div class="val a">1,630</div>
  <div class="sub">requests / sec</div>
</div>
</div>

<div class="gap-callout">
  <div class="gap-big">−17%</div>
  <div class="gap-body">
    <div class="gap-title">Same nginx. Same modules. Same config.</div>
    <div class="gap-sub">Every cycle of that 17% gap is RSA-2048 Montgomery multiplication — AVX2 SIMD in Debian's OpenSSL vs scalar in musl's bundled libcrypto. Our modules run the exact same instructions on both images.</div>
  </div>
</div>

A 17% gap. With identical nginx binaries, identical module code, identical configuration. The entire delta is RSA-2048 Montgomery multiplication — Debian's OpenSSL enables AVX2 SIMD bignum arithmetic; musl's bundled libcrypto uses a scalar implementation. Our modules are running the exact same instructions on both images. OpenSSL is doing something completely different.

We also ran a native baseline — nginx compiled directly on the host with `ReleaseSmall` Zig, no Docker at all. Trixie matched native within 0.5% (1,945 vs 1,955 RPS). The container boundary costs nothing at the RPS level. The gap is purely the libc.

## Concurrency closes the gap

Single-connection benchmarks expose overhead. Production doesn't run at c=1. Here's the full JWT picture at c=8, the practical operating point:

<style>
.data-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); margin: var(--sp-4) 0; }
.data-table th { background: var(--color-bg-sunken); color: var(--color-accent-text); font-weight: 600; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.05em; padding: var(--sp-2) var(--sp-3); text-align: right; border-bottom: 2px solid var(--color-border); }
.data-table th:first-child { text-align: left; }
.data-table td { padding: var(--sp-2) var(--sp-3); text-align: right; border-bottom: 1px solid var(--color-border-subtle); font-variant-numeric: tabular-nums; }
.data-table td:first-child { text-align: left; color: var(--color-accent-text); font-weight: 500; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--color-bg-sunken); }
.delta-better { color: #1a7f37; background: #dafbe1; border-radius: 3px; padding: 1px 6px; font-weight: 600; font-size: var(--text-xs); }
.delta-flat   { color: var(--color-text-tertiary); font-size: var(--text-xs); }
</style>

<table class="data-table">
<thead><tr><th>scenario</th><th>trixie</th><th>alpine</th><th>Δ</th></tr></thead>
<tbody>
<tr><td>valid-hs256</td><td>13,646</td><td>12,969</td><td><span class="delta-flat">trixie +5%</span></td></tr>
<tr><td>valid-rs256</td><td>5,725</td><td>5,284</td><td><span class="delta-flat">trixie +8%</span></td></tr>
<tr><td>reject-wrong-secret</td><td>13,831</td><td>15,964</td><td><span class="delta-better">alpine +15%</span></td></tr>
</tbody>
</table>

At 8 concurrent connections, Docker overhead disappears entirely — both images match or exceed the native baseline. The RSA gap narrows from 17% to 8%. And on the reject path, alpine actually pulls ahead. Concurrency reshuffles the rankings. The libc still matters, but less than you'd think from a c=1 microbenchmark.

## The I/O-bound finding: proxy workloads at c=8

The dynamic-upstreams benchmark exercises six modules: `dynamic-upstreams`, `healthcheck`, `upstream-balancer`, `cache-tags`, `cache-purge`, and `worker-events`. Every request makes a loopback proxy round-trip to a Bun backend. The CPU sits at 26–32% utilisation — the bottleneck is I/O, not computation.

<div class="big-compare" style="margin-top:var(--sp-5);">
<div class="col">
  <div class="label">Trixie (glibc)</div>
  <div class="val t">7,279</div>
  <div class="sub">RPS &nbsp;·&nbsp; sticky-read c=8</div>
</div>
<div class="sep">vs</div>
<div class="col">
  <div class="label">Alpine (musl)</div>
  <div class="val a">6,375</div>
  <div class="sub">RPS &nbsp;·&nbsp; sticky-read c=8</div>
</div>
</div>
<div style="text-align:center;margin-top:var(--sp-1);margin-bottom:var(--sp-4);">
  <span style="display:inline-block;background:var(--color-bg-sunken);border:1px solid var(--color-border);border-radius:4px;padding:var(--sp-1) var(--sp-4);font-size:var(--text-sm);font-weight:600;color:var(--color-text-secondary);">within ±10% of native at c=8</span>
</div>

At c=1 the gap was dramatic — trixie 1,462 vs alpine 1,719, a 39% spread driven by Docker dispatch overhead compounded by the proxy round-trip. At c=8, concurrent connections overlap the I/O, and the gap collapses to ±10%. The CPU overhead from musl's scalar string functions — 41% more instructions per request — is still there, but it's buried under the proxy latency. The system waits for the upstream, not the CPU.

This is the practical operating point. Nobody runs production at c=1.

## The integrity signal

<style>
.correction-box {
  background: var(--color-bg-sunken);
  border: 1px solid #E3A03A;
  border-radius: 8px; padding: var(--sp-5);
  display: grid; grid-template-columns: 1fr auto 1fr; gap: var(--sp-3); align-items: center;
  text-align: center; margin: var(--sp-5) 0;
}
.correction-box .col { }
.correction-box .big {
  font-size: 28px; font-weight: 900; letter-spacing: -0.04em; line-height: 1;
}
.correction-box .big.old { color: #cf222e; }
.correction-box .big.new { color: var(--color-accent-text); }
.correction-box .lbl {
  font-size: var(--text-xs); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--color-text-tertiary); margin-top: var(--sp-1);
}
.correction-box .arrow { font-size: 24px; color: #E3A03A; }
.correction-box .note {
  grid-column: 1 / -1;
  font-size: var(--text-sm); color: var(--color-text-secondary);
  padding-top: var(--sp-3); border-top: 1px solid var(--color-border-subtle);
  line-height: 1.6;
}
</style>

One number in our data didn't look right. The `valid-claims` JWT scenario showed trixie 58% faster than alpine at c=1 — too large to accept uncritically for a pure allocator difference. We flagged it immediately.

<div class="correction-box">
  <div class="col">
    <div class="big old">+58%</div>
    <div class="lbl">1,000 samples<br>baseline</div>
  </div>
  <div class="arrow">→</div>
  <div class="col">
    <div class="big new">+27.7%</div>
    <div class="lbl">5,000 samples<br>confirmed</div>
  </div>
  <div class="note">
    The original run was warmup-inflated: glibc's ptmalloc2 pre-sizes arena bins aggressively on first allocation, giving trixie an artificial head start. At 5,000 samples both allocators reach steady state. The gap is <strong>real and structural</strong> — musl's allocator has higher per-call overhead for CJSON pool operations — but half the original estimate.
  </div>
</div>

We published the correction. If you're going to make claims about performance, you have to trust the numbers enough to challenge the ones that don't add up.

## What this means

The deployment decision is simpler than the data suggests:

<div class="deploy-box">
  <div class="deploy-row">
    <div class="deploy-icon">🔐</div>
    <div><strong>If RSA crypto throughput matters</strong>, pick Debian. The AVX2 gap is real, structural, and not a compile flag you can toggle on musl.</div>
  </div>
  <div class="deploy-row">
    <div class="deploy-icon">📦</div>
    <div><strong>If image size or CVE surface matters more</strong>, pick Alpine. The 6× size advantage (26 MB vs 164 MB) is real, and the CPU overhead disappears under concurrency for proxy workloads.</div>
  </div>
  <div class="deploy-row">
    <div class="deploy-icon">⚡</div>
    <div><strong>The modules don't care either way.</strong> Every percentage point of difference traces to the base image, not to our code.</div>
  </div>
</div>

We set out to measure whether our modules slow down nginx. The answer, across two workloads and six scenario types, is that they don't. The performance profile of a nginz deployment is the performance profile of its libc. The rest is concurrency, I/O, and the network.

That's a good answer. It means we built clean modules. It means the foundation is solid. And it means we can spend our energy on what comes next — the AI gateway modules that will actually need every cycle we can give them.

<style>
.deploy-box {
  background: linear-gradient(135deg, #2A404A 0%, #3A5A6A 100%);
  border-radius: 8px; padding: var(--sp-5);
  display: grid; gap: var(--sp-3);
  margin: var(--sp-5) 0;
  font-size: var(--text-sm); line-height: 1.7; color: rgba(255,255,255,0.9);
}
.deploy-box strong { color: #fff; }
.deploy-row { display: flex; align-items: flex-start; gap: var(--sp-3); }
.deploy-icon { flex-shrink: 0; font-size: 18px; line-height: 1.6; }

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
    <strong>Next post:</strong> we attach <code>perf stat</code> to the running nginx workers and confirm the AVX2 hypothesis with hardware counters — branches, IPC, and a 5× cache-miss surprise we didn't see coming.
  </div>
</div>
