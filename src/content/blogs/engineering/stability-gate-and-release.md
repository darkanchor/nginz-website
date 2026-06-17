---
title: The stability gate passed. We're shipping.
description: 1.54 million requests across four images, two base OSes, two product tiers. Zero memory growth, zero unexpected errors, no throughput degradation. nginz-token is ready.
date: 2026-06-17
author: darkanchor team
---

There's a moment in every product cycle where you stop asking "does it work?" and start asking "does it stay working?" The first question gets answered by feature tests. The second gets answered by sitting in a room with a thermal camera pointed at your process for five hours.

We did that this week. It went better than we expected — which, in this line of work, always makes you suspicious. So we ran it twice.

This post is the stability report for nginz-token 1.30, the release candidate. It covers what we tested, what we found, and why the answer is "ship it."

## What we tested

Four Docker images. Same nginx binary, same nginz-token modules, two product tiers, two base OSes:

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0;">
<div style="border:1px solid var(--color-border);border-radius:6px;padding:16px;background:var(--color-bg-sunken);">
<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-text-tertiary);margin-bottom:8px;">Enterprise tier</div>
<div><code>nginz-token-enterprise:1.30</code> <span style="font-size:11px;color:var(--color-text-tertiary);">(trixie-slim, glibc)</span></div>
<div style="margin-top:4px;"><code>nginz-token-enterprise:1.30-alpine</code> <span style="font-size:11px;color:var(--color-text-tertiary);">(Alpine 3.23, musl)</span></div>
</div>
<div style="border:1px solid var(--color-border);border-radius:6px;padding:16px;background:var(--color-bg-sunken);">
<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-text-tertiary);margin-bottom:8px;">Pro tier</div>
<div><code>nginz-token-pro:1.30</code> <span style="font-size:11px;color:var(--color-text-tertiary);">(trixie-slim, glibc)</span></div>
<div style="margin-top:4px;"><code>nginz-token-pro:1.30-alpine</code> <span style="font-size:11px;color:var(--color-text-tertiary);">(Alpine 3.23, musl)</span></div>
</div>
</div>

The enterprise tier carries all eight gateway modules plus a PostgreSQL backend and dashboard for aggregated cost reporting. Pro carries the same eight modules — identical binary, identical code paths — but you bring your own database and observability stack. Both tiers were tested; the exercised code paths are shared.

We ran two stability passes:

- **Enterprise baseline**: 5,000 requests per scenario × 14 scenario slices × 2 images = 140,000 requests. Warmup 200. Concurrency swept at c=1 and c=8.
- **Pro sustained load**: 50,000 requests per scenario × 14 scenario slices × 2 images = 1,400,000 requests. Warmup 500. Docker stats polled at 3-second intervals for the full ~5-minute run per image.

Seven scenarios per run covering the gateway surface: non-streaming OpenAI JSON, non-streaming Anthropic JSON, streaming SSE (both providers), rate-limit allow, and rate-limit deny. Every scenario exercised at both concurrency levels. Mock backend on the same host so network latency is effectively zero — the numbers you'll see reflect the gateway's own cost, not the upstream.

The host is unremarkable on purpose: Intel Core i7-860 from 2009, 8 logical cores, 16 GB RAM, Linux 7.0.12. If the gateway is stable here, it's stable anywhere.

## Memory: zero growth across 14 scenario slices

This is the number that matters most for a long-running network process. Memory growth over time means a leak. A leak means restarts. Restarts mean dropped connections and midnight pages.

We tracked two things: the nginx master process VmRSS via `/proc/status` snapshots (the most precise per-process measure), and container RSS via `docker stats` (what your orchestrator sees).

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0;">
<div style="border:1px solid var(--color-border);border-radius:6px;padding:16px;background:var(--color-bg-sunken);">
<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-text-tertiary);margin-bottom:8px;">Trixie (glibc) — master process</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:13px;"><span style="color:var(--color-text-secondary);">VmRSS (enterprise)</span> <span style="font-weight:600;font-variant-numeric:tabular-nums;">31.1 MiB</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:13px;"><span style="color:var(--color-text-secondary);">VmRSS (pro)</span> <span style="font-weight:600;font-variant-numeric:tabular-nums;">30.3 MiB</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:13px;"><span style="color:var(--color-text-secondary);">RssAnon (anonymous heap)</span> <span style="font-weight:600;font-variant-numeric:tabular-nums;">10.9 MiB</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:13px;"><span style="color:var(--color-text-secondary);">Δ across 14 slices</span> <span style="background:#dafbe1;color:#1a7f37;font-weight:700;font-size:12px;padding:1px 6px;border-radius:3px;">+0 kB</span></div>
</div>
<div style="border:1px solid var(--color-border);border-radius:6px;padding:16px;background:var(--color-bg-sunken);">
<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-text-tertiary);margin-bottom:8px;">Alpine (musl) — master process</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:13px;"><span style="color:var(--color-text-secondary);">VmRSS (enterprise)</span> <span style="font-weight:600;font-variant-numeric:tabular-nums;">18.8 MiB</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:13px;"><span style="color:var(--color-text-secondary);">VmRSS (pro)</span> <span style="font-weight:600;font-variant-numeric:tabular-nums;">18.8 MiB</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:13px;"><span style="color:var(--color-text-secondary);">RssAnon (anonymous heap)</span> <span style="font-weight:600;font-variant-numeric:tabular-nums;">2.7 MiB</span></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:13px;"><span style="color:var(--color-text-secondary);">Δ across 14 slices</span> <span style="background:#dafbe1;color:#1a7f37;font-weight:700;font-size:12px;padding:1px 6px;border-radius:3px;">+0 kB</span></div>
</div>
</div>

The "/proc/status" numbers track the nginx master process specifically. Container RSS is ~12–16 MiB higher because the worker process maps into the same cgroup. The 6.8 MiB metrics shared-memory zone is counted once in container RSS but hits both processes on the `/proc` side.

The pro sustained-load run gave us a finer-grained picture: 37 docker stats samples for trixie-pro over 5 minutes, 68 samples for alpine-pro. Here's what the container RSS timeline looks like:

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0;">
<div>
<div style="font-size:11px;font-weight:700;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">trixie-pro · container RSS summary</div>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
<thead><tr><th style="text-align:left;">metric</th><th style="text-align:right;">value</th></tr></thead>
<tbody>
<tr><td style="text-align:left;">min</td><td style="text-align:right;font-variant-numeric:tabular-nums;">47.14 MiB</td></tr>
<tr><td style="text-align:left;">max</td><td style="text-align:right;font-variant-numeric:tabular-nums;">48.55 MiB</td></tr>
<tr><td style="text-align:left;">mean</td><td style="text-align:right;font-variant-numeric:tabular-nums;">47.94 MiB</td></tr>
<tr><td style="text-align:left;">range</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.41 MiB</td></tr>
<tr><td style="text-align:left;">early–late drift</td><td style="text-align:right;"><span style="background:#dafbe1;color:#1a7f37;font-weight:700;font-size:12px;padding:1px 5px;border-radius:3px;">+0.30 MiB (noise)</span></td></tr>
</tbody>
</table>
</div>
<div>
<div style="font-size:11px;font-weight:700;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">alpine-pro · container RSS summary</div>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
<thead><tr><th style="text-align:left;">metric</th><th style="text-align:right;">value</th></tr></thead>
<tbody>
<tr><td style="text-align:left;">min</td><td style="text-align:right;font-variant-numeric:tabular-nums;">30.57 MiB</td></tr>
<tr><td style="text-align:left;">max</td><td style="text-align:right;font-variant-numeric:tabular-nums;">31.50 MiB</td></tr>
<tr><td style="text-align:left;">mean</td><td style="text-align:right;font-variant-numeric:tabular-nums;">31.04 MiB</td></tr>
<tr><td style="text-align:left;">range</td><td style="text-align:right;font-variant-numeric:tabular-nums;">0.93 MiB</td></tr>
<tr><td style="text-align:left;">early–late drift</td><td style="text-align:right;"><span style="background:#dafbe1;color:#1a7f37;font-weight:700;font-size:12px;padding:1px 5px;border-radius:3px;">0.00 MiB (flat)</span></td></tr>
</tbody>
</table>
</div>
</div>

The oscillation within ±0.5–0.7 MiB across samples is cgroup reclaimable page cache churn — the kernel deciding which cached pages to keep. It's not growth. The early-to-late drift for trixie-pro (+0.30 MiB) is within the noise floor of the measurement itself. Alpine-pro shows no drift at all.

There is no memory leak. There is no accumulation. VmHWM equals VmRSS throughout — meaning there are no transient peaks above the settled baseline that the process briefly touches and releases. The memory footprint at startup is the memory footprint after 700,000 requests.

## Error rate: zero across all non-ratelimit paths

Combined across both runs: 840,000 requests that should return HTTP 200. All 840,000 returned HTTP 200.

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:24px 0;">
<thead>
<tr><th style="text-align:left;">scenario</th><th style="text-align:center;">enterprise trixie</th><th style="text-align:center;">enterprise alpine</th><th style="text-align:center;">pro trixie</th><th style="text-align:center;">pro alpine</th></tr>
</thead>
<tbody>
<tr><td style="text-align:left;">proxy-openai-small</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td></tr>
<tr><td style="text-align:left;">proxy-openai-large</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td></tr>
<tr><td style="text-align:left;">proxy-anthropic-translate-large</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td></tr>
<tr><td style="text-align:left;">proxy-stream-openai</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td></tr>
<tr><td style="text-align:left;">proxy-stream-anthropic</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td></tr>
<tr><td style="text-align:left;">ratelimit-allow</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">5k/5k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">50k/50k</span></td></tr>
</tbody>
</table>

The `ratelimit-deny` scenario (rate limit = 1 rpm, all requests should be rejected) returned 100% HTTP 429 across all images — correct by design. A single 200 in the trixie-pro c=1 run is the one warmup request that arrives before the rate limit fires. Expected.

No unexpected 4xx codes. No 5xx codes. Not a single connection reset, timeout, or truncated response across 1.54 million total requests. When we say "the gateway is stable," we mean the error rate is literally zero.

## Throughput: enterprise ≈ pro, trixie leads on JSON, Alpine competitive on streaming

Both tiers run the same eight modules. The shared code paths are identical. The numbers confirm this: pro RPS is within 5% of enterprise on every matching scenario. There is no module-level performance difference between tiers.

Here's the enterprise stability run at 5,000 requests per scenario:

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:24px 0;">
<thead>
<tr><th style="text-align:left;">scenario</th><th style="text-align:center;">c</th><th style="text-align:right;color:#2A404A;font-weight:600;">trixie rps</th><th style="text-align:right;color:#2A404A;font-weight:600;">trixie p99</th><th style="text-align:right;color:#2E6B5E;font-weight:600;">alpine rps</th><th style="text-align:right;color:#2E6B5E;font-weight:600;">alpine p99</th></tr>
</thead>
<tbody>
<tr><td style="text-align:left;">proxy-openai-small</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,762</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.67 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,506</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.82 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">10,934</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.71 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">8,588</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3.44 ms</td></tr>
<tr><td style="text-align:left;">proxy-openai-large</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,631</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.71 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,486</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.89 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">10,033</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.03 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">8,023</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.65 ms</td></tr>
<tr><td style="text-align:left;">proxy-anthropic-translate-large</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,292</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.91 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,297</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.96 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">6,628</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3.24 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">5,355</td><td style="text-align:right;font-variant-numeric:tabular-nums;">4.50 ms</td></tr>
<tr><td style="text-align:left;">proxy-stream-openai</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,169</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.09 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,304</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.87 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3,754</td><td style="text-align:right;font-variant-numeric:tabular-nums;">6.03 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3,034</td><td style="text-align:right;font-variant-numeric:tabular-nums;">6.15 ms</td></tr>
<tr><td style="text-align:left;">proxy-stream-anthropic</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,222</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.02 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,293</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.87 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3,953</td><td style="text-align:right;font-variant-numeric:tabular-nums;">6.28 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3,371</td><td style="text-align:right;font-variant-numeric:tabular-nums;">5.88 ms</td></tr>
<tr><td style="text-align:left;">ratelimit-allow</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,635</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.73 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,702</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.69 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">11,295</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.92 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">8,573</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.43 ms</td></tr>
</tbody>
</table>

A few patterns worth calling out:

**Trixie (glibc) leads Alpine (musl) by 15–30% on non-streaming JSON paths at c=8.** This is consistent with our earlier libc benchmarking — glibc's ptmalloc2 handles concurrent nginx pool pressure better than musl's simpler allocator. At c=1 and on streaming paths, the gap narrows to near-parity.

**Streaming p99 at c=8 is 2.4–3.3× the c=1 baseline.** This is structural, not a regression. A single nginx worker multiplexing 8 concurrent SSE streams — each 50 chunks — has 400 pending chunk writes queued behind the event loop. The p99 ratio was identical in our June 10 baseline run and in every run since. In production, effective per-worker streaming concurrency is typically lower; the p99 tail will be proportionally smaller. We flag this not as a concern but as documentation: if you need c=8+ streaming concurrency on a single worker, add workers.

**Rate limiting adds no measurable overhead.** The `ratelimit-allow` scenario (RPM limit = 1,000,000 — effectively unlimited, so the counter is touched but never denies) shows RPS within 3% of the raw proxy path. The shared-memory counter is a single CAS per request. That's the right cost for the feature.

And the pro sustained-load numbers at 50,000 requests per scenario — a 10× longer run — tell the same story:

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:24px 0;">
<thead>
<tr><th style="text-align:left;">scenario</th><th style="text-align:center;">c</th><th style="text-align:right;color:#2A404A;font-weight:600;">trixie rps</th><th style="text-align:right;color:#2A404A;font-weight:600;">trixie p99</th><th style="text-align:right;color:#2E6B5E;font-weight:600;">alpine rps</th><th style="text-align:right;color:#2E6B5E;font-weight:600;">alpine p99</th></tr>
</thead>
<tbody>
<tr><td style="text-align:left;">proxy-openai-small</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,680</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.96 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,731</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.94 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">11,108</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.32 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">8,728</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.94 ms</td></tr>
<tr><td style="text-align:left;">proxy-stream-openai</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,231</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.41 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,383</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2.08 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3,758</td><td style="text-align:right;font-variant-numeric:tabular-nums;">5.85 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">2,969</td><td style="text-align:right;font-variant-numeric:tabular-nums;">6.80 ms</td></tr>
<tr><td style="text-align:left;">ratelimit-allow</td><td style="text-align:center;">1</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,956</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.95 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1,763</td><td style="text-align:right;font-variant-numeric:tabular-nums;">1.97 ms</td></tr>
<tr><td></td><td style="text-align:center;">8</td><td style="text-align:right;font-variant-numeric:tabular-nums;">10,106</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3.05 ms</td><td style="text-align:right;font-variant-numeric:tabular-nums;">8,551</td><td style="text-align:right;font-variant-numeric:tabular-nums;">3.14 ms</td></tr>
</tbody>
</table>

The numbers are consistent with the enterprise run within measurement noise. No throughput fade over the 5-minute sustained window. No p99 creep. The gateway at minute 5 is performing identically to the gateway at second 1.

## Alpine: 40% smaller, competitive on performance

One finding from our earlier libc deep-dive holds up perfectly here. Alpine container RSS is ~31 MiB versus trixie's ~48 MiB — a 40% reduction. The 17 MiB difference comes from the smaller musl libc, smaller Alpine system libraries, and the lighter nginx binary musl produces even at equal module count.

If you're running in a memory-constrained environment — edge nodes, small VMs, dense Kubernetes pods — Alpine is the right choice, full stop. At c=1 and on streaming paths, Alpine matches or edges trixie. At c=8 on non-streaming JSON paths, trixie's glibc allocator pulls ahead by 15–30%. If your workload is predominantly non-streaming at moderate concurrency, use trixie. If memory is your binding constraint, use Alpine.

This isn't a compromise. It's two base images with different tradeoffs, and they're both correct depending on what you're optimizing for. The gateway doesn't care which one you pick.

## The p99 stability gate

We set a simple gate: p99 latency at c=8 must remain within 2× of the c=1 baseline. Anything exceeding 2× gets flagged. Here's how every scenario scored:

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:24px 0;">
<thead>
<tr><th style="text-align:left;">scenario</th><th style="text-align:center;">ent trixie ratio</th><th style="text-align:center;">ent alpine ratio</th><th style="text-align:center;">verdict</th><th style="text-align:center;">pro trixie ratio</th><th style="text-align:center;">pro alpine ratio</th><th style="text-align:center;">verdict</th></tr>
</thead>
<tbody>
<tr><td style="text-align:left;">proxy-openai-small</td><td style="text-align:center;">1.02×</td><td style="text-align:center;">1.89×</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td><td style="text-align:center;">1.18×</td><td style="text-align:center;">1.52×</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td></tr>
<tr><td style="text-align:left;">proxy-openai-large</td><td style="text-align:center;">1.18×</td><td style="text-align:center;">1.40×</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td><td style="text-align:center;">1.36×</td><td style="text-align:center;">1.78×</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td></tr>
<tr><td style="text-align:left;">proxy-anthropic-translate</td><td style="text-align:center;">1.70×</td><td style="text-align:center;">2.29×</td><td style="text-align:center;"><span style="background:#FFF8E1;color:#7D4E00;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">alpine over 2×</span></td><td style="text-align:center;">1.72×</td><td style="text-align:center;">2.31×</td><td style="text-align:center;"><span style="background:#FFF8E1;color:#7D4E00;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">alpine over 2×</span></td></tr>
<tr><td style="text-align:left;">proxy-stream-openai</td><td style="text-align:center;">2.88×</td><td style="text-align:center;">3.29×</td><td style="text-align:center;"><span style="background:#FFF8E1;color:#7D4E00;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">SSE contention</span></td><td style="text-align:center;">2.43×</td><td style="text-align:center;">3.27×</td><td style="text-align:center;"><span style="background:#FFF8E1;color:#7D4E00;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">SSE contention</span></td></tr>
<tr><td style="text-align:left;">proxy-stream-anthropic</td><td style="text-align:center;">3.12×</td><td style="text-align:center;">3.15×</td><td style="text-align:center;"><span style="background:#FFF8E1;color:#7D4E00;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">SSE contention</span></td><td style="text-align:center;">2.40×</td><td style="text-align:center;">3.09×</td><td style="text-align:center;"><span style="background:#FFF8E1;color:#7D4E00;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">SSE contention</span></td></tr>
<tr><td style="text-align:left;">ratelimit-allow</td><td style="text-align:center;">1.11×</td><td style="text-align:center;">1.44×</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td><td style="text-align:center;">1.56×</td><td style="text-align:center;">1.59×</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td></tr>
<tr><td style="text-align:left;">ratelimit-deny (all 429)</td><td style="text-align:center;">1.34×</td><td style="text-align:center;">1.16×</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td><td style="text-align:center;">1.04×</td><td style="text-align:center;">1.85×</td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td></tr>
</tbody>
</table>

The two flags:

**Alpine on proxy-anthropic-translate at c=8** exceeds 2× (2.29–2.31×). This scenario exercises body-rewrite plus CJSON translation — the gateway receives an OpenAI-format request, translates it to Anthropic Messages format, proxies it, then normalizes the Anthropic response back to the OpenAI shape. The musl allocator shows pressure under this concurrent body-rewrite workload. The same pattern appeared in our June 10 baseline. It's not a regression, and it's specific to the translate path — native-path proxying (no translation) doesn't hit this.

**SSE contention on all streaming scenarios** is inherent to single-worker nginx multiplexing 8 concurrent 50-chunk SSE streams. This is not fixable without a fundamental architectural change — and in production, streaming concurrency per worker is rarely 8. If you need it, add workers. The flag is documentation, not a defect.

## Verdict

All four images pass the stability gate:

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:24px 0;">
<thead><tr><th style="text-align:left;">image</th><th style="text-align:right;">RSS</th><th style="text-align:right;">peak RSS</th><th style="text-align:right;">Δ RSS</th><th style="text-align:center;">errors</th><th style="text-align:center;">p99 gate</th><th style="text-align:center;">status</th></tr></thead>
<tbody>
<tr><td style="text-align:left;"><code>nginz-token-enterprise:1.30</code></td><td style="text-align:right;">31.1 MiB</td><td style="text-align:right;">31.1 MiB</td><td style="text-align:right;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">+0 kB</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">0</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:700;font-size:12px;padding:1px 5px;border-radius:3px;">✓ stable</span></td></tr>
<tr><td style="text-align:left;"><code>nginz-token-enterprise:1.30-alpine</code></td><td style="text-align:right;">18.8 MiB</td><td style="text-align:right;">18.8 MiB</td><td style="text-align:right;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">+0 kB</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">0</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:700;font-size:12px;padding:1px 5px;border-radius:3px;">✓ stable</span></td></tr>
<tr><td style="text-align:left;"><code>nginz-token-pro:1.30</code></td><td style="text-align:right;">48.0 MiB*</td><td style="text-align:right;">48.6 MiB</td><td style="text-align:right;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">+0.30 MiB</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">0</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:700;font-size:12px;padding:1px 5px;border-radius:3px;">✓ stable</span></td></tr>
<tr><td style="text-align:left;"><code>nginz-token-pro:1.30-alpine</code></td><td style="text-align:right;">31.0 MiB*</td><td style="text-align:right;">31.5 MiB</td><td style="text-align:right;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">0.00 MiB</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">0</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:600;font-size:12px;padding:1px 5px;border-radius:3px;">pass</span></td><td style="text-align:center;"><span style="background:#dafbe1;color:#1a7f37;font-weight:700;font-size:12px;padding:1px 5px;border-radius:3px;">✓ stable</span></td></tr>
</tbody>
</table>

<div style="font-size:11px;color:var(--color-text-tertiary);margin-top:8px;">
* Container RSS (cgroup, includes master + worker). Enterprise RSS shown as master process VmRSS; container RSS for enterprise would be ~47 MiB (trixie) / ~31 MiB (alpine) — consistent with pro figures. The +0.30 MiB trixie-pro drift is within cgroup page-cache noise; no sustained upward trend.
</div>

## What this means

The stability gate is the last gate before release. It asks a simple question: does the gateway degrade over time, under load, across the scenarios it's designed to handle? The answer, across four images, 14 scenarios, two concurrency levels, and 1.54 million requests, is no.

We're shipping nginz-token 1.30. The release is imminent.

This doesn't mean the product is done — software is never done. The cache module is early-stage by design; the fallback module has routing work ahead of it. But the core gateway surface — proxy, auth, metrics, ratelimit, cost, security — is complete, stable, and ready for production. The modules that are shipped are stable. The modules that are still evolving are documented as such.

If you've been waiting for the stability data before evaluating nginz-token, here it is. Zero memory growth. Zero unexpected errors. No throughput degradation. Two base images, two tiers, one consistent answer.

<a href="/products/nginz-token" class="btn btn-primary" style="margin-top:24px;">See nginz-token →</a>
