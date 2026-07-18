---
title: Build yourself an AI gateway in nginx
description: nginz-token is source-available under BSL 1.1. Here is how to compile its eight Zig modules into stock nginx and stand up a working gateway with a five-line credential config — one repo, three commands, no external dependencies.
date: 2026-07-22
author: darkanchor team
---

nginz-token ships as prebuilt Docker images to Pro and Enterprise subscribers. That is the product. But the source is available under the [Business Source License 1.1](https://github.com/darkanchor/nginz-token/blob/main/LICENSE), and our Pro tier is self-serve — which means anyone with a subscription has every reason to pull the repo, read the code, and build it themselves if they want to.

This post is the build tutorial. One repo. Three commands. A working AI gateway.

## What you are building

Eight native nginx modules, compiled from Zig into position-independent object files, linked into nginx at build time:

<style>
.data-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); margin: var(--sp-4) 0; }
.data-table th { background: var(--color-bg-sunken); color: var(--color-accent-text); font-weight: 600; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.05em; padding: var(--sp-2) var(--sp-3); text-align: left; border-bottom: 2px solid var(--color-border); }
.data-table td { padding: var(--sp-2) var(--sp-3); text-align: left; border-bottom: 1px solid var(--color-border-subtle); vertical-align: top; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--color-bg-sunken); }
.data-table td:first-child { font-family: var(--font-mono, monospace); font-size: var(--text-xs); color: var(--color-accent-text); white-space: nowrap; }
.data-table td:nth-child(2) { color: var(--color-text); }
</style>

<table class="data-table">
<thead><tr><th>module</th><th>what it does</th></tr></thead>
<tbody>
<tr><td>llm-proxy</td><td>Provider routing, dialect translation (OpenAI ↔ Anthropic), SSE normalization, usage extraction. The substrate every other module depends on.</td></tr>
<tr><td>llm-auth</td><td>Provider credential resolution from env, file, or literal sources. Client/project/org cascade with fingerprint-safe observability.</td></tr>
<tr><td>llm-ratelimit</td><td>Token-per-minute and request-per-minute budgets enforced in shared memory before the upstream call leaves the building.</td></tr>
<tr><td>llm-fallback</td><td>Retry, replacement, and replay policy. Route by failure class. Model override on fallback. Translation-aware replay.</td></tr>
<tr><td>llm-metrics</td><td>Prometheus export: provider counters, latency histogram, usage accounting, bounded auth/model label families.</td></tr>
<tr><td>llm-cost</td><td>Per-request cost attribution to client/project/org. Rate-card accounting. Optional PostgreSQL persistence.</td></tr>
<tr><td>llm-security</td><td>PII and secrets scanning at the edge. Prompt injection detection. Org/project layered policy inheritance.</td></tr>
<tr><td>llm-cache</td><td>Cache eligibility and isolation rules. Explicit policy, not semantic replay magic.</td></tr>
</tbody>
</table>

If you have run an nginx reverse proxy before, the config surface will feel familiar. No sidecars, no control planes, no YAML DSLs. Each module registers a handful of directives that compose inside `location` blocks. The gateway *is* nginx.

## Prerequisites

A Linux machine (amd64 or aarch64) with:

- **Zig 0.16.0** — the exact version. The build system checks at comptime and refuses anything else. [Download from ziglang.org](https://ziglang.org/download/) and put `zig` on your `$PATH`.
- **C build tools and libraries**: `make`, `gcc`, `openssl`, `pcre2`, `zlib`, `libpq`, `libxml2`, `libxslt`.
- **nginx source** is vendored as a git submodule — you do not need to download it separately.

Debian/Ubuntu:

```bash
apt install -y make build-essential libssl-dev libpcre2-dev \
  zlib1g-dev libpq-dev libxml2-dev libxslt-dev git curl xz-utils
```

Alpine:

```bash
apk add make build-base openssl-dev pcre2-dev zlib-dev \
  libpq-dev libxml2-dev libxslt-dev git curl xz
```

Arch:

```bash
pacman -S make gcc openssl pcre2 zlib postgresql-libs \
  libxml2 libxslt git curl xz
```

## Step 1: Clone and build the modules

```bash
git clone https://github.com/darkanchor/nginz-token.git
cd nginz-token
git submodule update --init
zig build -Doptimize=ReleaseSmall package
```

That is it. `git submodule update --init` pulls the vendored nginx source (plus njs and QuickJS, which you can ignore — they are not needed for the AI gateway). `zig build package` compiles each module into a position-independent `.o` file and generates an nginx `config` stub for `./configure --add-module`. The output lands in `zig-out/modules/`:

```text
zig-out/modules/
├── llm-proxy/
│   ├── config
│   ├── ngx_http_llm_proxy_module.o
│   └── libcjson.a
├── llm-auth/
│   ├── config
│   └── ngx_http_llm_auth_module.o
├── llm-metrics/
│   ├── config
│   └── ngx_http_llm_metrics_module.o
├── llm-fallback/
│   ├── config
│   └── ngx_http_llm_fallback_module.o
├── llm-ratelimit/
│   ├── config
│   └── ngx_http_llm_ratelimit_module.o
├── llm-cost/
│   ├── config
│   └── ngx_http_llm_cost_module.o
├── llm-cache/
│   ├── config
│   └── ngx_http_llm_cache_module.o
└── llm-security/
    ├── config
    └── ngx_http_llm_security_module.o
```

Each `config` file is a short shell fragment that tells nginx's build system which module name to register and where the precompiled object lives. The entire `zig-out/modules/` tree is a few megabytes.

## Step 2: Configure and build nginx

Point nginx's `./configure` at the eight module directories. The nginx source lives in `submodules/nginx` — that is what the submodule init pulled:

```bash
cd submodules/nginx

./auto/configure \
    --with-http_ssl_module \
    --with-http_v2_module \
    --with-http_realip_module \
    --with-http_auth_request_module \
    --with-http_stub_status_module \
    --add-module=../../../nginz-token/zig-out/modules/llm-proxy \
    --add-module=../../../nginz-token/zig-out/modules/llm-auth \
    --add-module=../../../nginz-token/zig-out/modules/llm-metrics \
    --add-module=../../../nginz-token/zig-out/modules/llm-fallback \
    --add-module=../../../nginz-token/zig-out/modules/llm-ratelimit \
    --add-module=../../../nginz-token/zig-out/modules/llm-cost \
    --add-module=../../../nginz-token/zig-out/modules/llm-cache \
    --add-module=../../../nginz-token/zig-out/modules/llm-security

make -j$(nproc)
```

The `--add-module` paths jump from `submodules/nginx` back to the repo root's `zig-out/modules/`. The configure flags are minimal — SSL, HTTP/2, realip, auth_request, and stub_status. Add whatever else your deployment needs.

Verify:

```bash
objs/nginx -V 2>&1 | tr ' ' '\n' | grep llm
```

You should see all eight `--add-module=.../llm-*` entries. The modules are compiled in.

## Step 3: Write a config and start the gateway

```nginx
daemon off;
error_log /dev/stderr info;

env OPENAI_API_KEY;

events {
    worker_connections 64;
}

http {
    access_log /dev/stdout;
    variables_hash_max_size 2048;
    variables_hash_bucket_size 128;

    upstream openai_api {
        server api.openai.com:443;
    }

    server {
        listen 8080;

        location /v1/chat/completions {
            # ── AI gateway ─────────────────────────────────
            llm_proxy;
            llm_proxy_route openai openai_api;
            llm_proxy_default_provider openai;

            llm_auth;
            llm_auth_credential openai env:OPENAI_API_KEY;
            # ────────────────────────────────────────────────

            proxy_ssl_server_name on;
            proxy_pass https://openai_api;
        }
    }
}
```

Five directives. `llm_proxy` parses the request body, identifies it as OpenAI dialect, selects the `openai` route. `llm_auth` reads `$OPENAI_API_KEY` from the environment and injects `Authorization: Bearer <key>` into the proxied request. `proxy_pass` sends it upstream. On the response path, `llm_proxy` extracts usage tokens and populates `$llm_prompt_tokens`, `$llm_completion_tokens`, and `$llm_total_tokens` — available for access logging.

Start it:

```bash
OPENAI_API_KEY=sk-... objs/nginx -p /tmp/nginx-test -c nginx.conf
```

## Step 4: Send a request

```bash
curl -s http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [{"role": "user", "content": "hello"}]
  }' | jq .
```

If the key is valid, you get a normal OpenAI chat completion response. The client has no idea an AI gateway intercepted the request — same JSON shape it would get from `api.openai.com` directly.

<div class="gap-callout">
  <div class="gap-big">Five lines</div>
  <div class="gap-body">
    <div class="gap-title">That is the whole gateway config.</div>
    <div class="gap-sub"><code>llm_proxy</code>, <code>llm_proxy_route</code>, <code>llm_proxy_default_provider</code>, <code>llm_auth</code>, and <code>llm_auth_credential</code>. Five directives. Your services never touch the real API key. When you rotate it, you update one config file and reload nginx.</div>
  </div>
</div>

## What the other six modules give you

The five-line config works. The other six modules are additive — each a few more directives in a `location` block:

**Credential cascade.** Not stuck with one API key. Client → project → org cascade with fallback to a shared key:

```nginx
llm_auth_tenant              $http_x_llm_client;
llm_auth_tenant_credential   client-a openai env:CLIENT_A_OPENAI_KEY;
llm_auth_credential          openai env:OPENAI_SHARED_KEY;
llm_auth_tenant_fallback_shared on;
llm_auth_fail_closed         on;
```

**Rate limiting.** Token-per-minute and request-per-minute budgets in shared memory, checked before `proxy_pass` opens a connection. Runaway job gets a 429 before it reaches OpenAI:

```nginx
llm_ratelimit;
llm_ratelimit_zone tokens  shared:llm_tokens:10m  rate=100000/m;
llm_ratelimit_zone requests shared:llm_rpm:10m    rate=500/m;
```

**Provider failover.** Retry on 5xx or connect error, with automatic dialect translation when the fallback provider speaks a different protocol:

```nginx
llm_fallback;
llm_fallback_route openai anthropic;
llm_fallback_on upstream_5xx connect_error;
```

**Prometheus metrics.** Provider counters, latency histogram, usage accounting — all on a separate port, no sidecar:

```nginx
server {
    listen 9145;
    location /metrics { llm_metrics; }
}
```

**Cost attribution.** Per-request cost to client/project/org, with optional PostgreSQL persistence:

```nginx
llm_cost;
llm_cost_label org     $llm_auth_org;
llm_cost_label project $llm_auth_project;
llm_cost_label client  $llm_auth_client;
```

**Security scanning.** PII, secrets, and prompt injection detection at the edge — before prompts leave your infrastructure:

```nginx
llm_security;
llm_security_mode block;
llm_security_rules_file /etc/nginx/llm-security/rules.conf;
llm_security_inspect_response on;
```

## What you do not get

This is a source build. It is not the product. The Docker images ship with more: the full [nginz](https://github.com/darkanchor/nginz) infrastructure layer (24 additional modules — JWT, OIDC, WAF, circuit breaking, dynamic upstreams, and more), njs scripting, entrypoint scripts that tune worker processes, envsubst templating, and pre-tested module compatibility across pinned revisions. Pro and Enterprise subscribers get private-registry images and support.

The build process above is intentionally minimal. It compiles the AI gateway modules into nginx and nothing else. If you later want the full stack, the Docker images use the same `zig build package` → `./configure --add-module` → `make` pipeline — your nginx.conf does not change.

## Why inside nginx

Some AI gateways run as separate services. Some run as SaaS proxies. Some embed a LuaJIT runtime.

This one is compiled to native code. It runs in the same process as nginx — same event loop, same shared memory, same connection pool. The added latency is microseconds of JSON parsing and in-process bookkeeping, not a network hop to an external service. And because the gateway *is* nginx, everything you already know about operating nginx still applies: same reload signal, same log format, same `proxy_*` directives.

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

<div class="lessons-box">
  <h4>Where to go from here</h4>
  <div class="lessons-row">
    <div class="lessons-icon">📦</div>
    <div><strong>Read the source.</strong> Everything is at <a href="https://github.com/darkanchor/nginz-token" style="color:#99DDCC">github.com/darkanchor/nginz-token</a>. Each module has its own README with design rationale and directive reference. Start with <code>src/modules/llm-proxy-nginx-module/README.md</code> — the proxy substrate is the foundation.</div>
  </div>
  <div class="lessons-row">
    <div class="lessons-icon">🧪</div>
    <div><strong>Run the integration tests.</strong> <code>bun test tests/llm-proxy/</code>. The test harness builds a temporary nginx binary, starts it on a dynamic port, and runs the full suite against mock upstreams. No external services needed.</div>
  </div>
  <div class="lessons-row">
    <div class="lessons-icon">🐳</div>
    <div><strong>Or skip the source build entirely.</strong> <a href="/products/nginz-token" style="color:#99DDCC">nginz-token Pro</a> ships as prebuilt Docker images — Debian trixie-slim and Alpine 3.23, linux/amd64, with all eight modules compiled in and stability-tested. Same config surface. Same directives. No build step.</div>
  </div>
</div>

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
.lessons-box a { color: #99DDCC; }
</style>
