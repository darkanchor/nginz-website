---
title: nftables IP Policy
description: Block or allow IP addresses at the kernel level using Linux nftables named sets, with no nginx reload required.
---

# nftables IP Policy

Use this module when you need IP access control that updates in milliseconds by delegating membership checks to the kernel's nftables subsystem.

## When to use this module

- You want to block abusive IPs at the nginx layer without reloading configuration every time the blocklist changes.
- You need allowlist-style protection for internal endpoints where only known IPs should pass through.
- You want per-IP rate limiting with automatic temporary bans that persist across nginx workers.
- You run honeypot or tarpit endpoints that should add the client IP to a blocklist automatically.
- You need CIDR prefix matching against nftables interval sets for corporate network ranges.

## nginx.conf synthesis

### Blocklist mode

Block known abusive IPs by checking them against an nftables set.

```nginx
location / {
    nftset         on;
    nftset_table   filter;
    nftset_set     blocklist;
    nftset_family  inet;
    nftset_deny    on;

    proxy_pass http://backend;
}
```

Add an IP at runtime with a single nft command. No nginx reload needed.

```bash
nft add element inet filter blocklist { 203.0.113.42 }
```

### Allowlist mode

Restrict an internal API to trusted IPs only.

```nginx
location /internal/api {
    nftset         on;
    nftset_table   filter;
    nftset_set     trusted;
    nftset_family  inet;
    nftset_deny    off;

    proxy_pass http://internal;
}
```

### Rate limiting with automatic ban

Limit login attempts and temporarily ban repeat offenders.

```bash
nft add set ip filter ratelimit_banned '{ type ipv4_addr; flags dynamic,timeout; timeout 5m; }'
```

```nginx
location /login {
    nftset on;
    nftset_set ratelimit_banned;
    nftset_cache_ttl 5s;

    nftset_ratelimit_rate   10r/s;
    nftset_ratelimit_burst  5;
    nftset_ratelimit_status 429;

    nftset_autoban_table   filter;
    nftset_autoban_set     ratelimit_banned;
    nftset_autoban_timeout 10m;

    proxy_pass http://auth_backend;
}
```

## Directive reference

### `nftset`

- **Contexts:** `http`, `server`, `location`
- **Default:** `off`

Enables nftables IP checking for this context.

### `nftset_table`, `nftset_set`, and `nftset_family`

- **Contexts:** `http`, `server`, `location`
- **Defaults:** `filter`, `blocklist`, `inet`

Identify which nftables set to query. `nftset_set` accepts the combined `table:set` form, which overrides `nftset_table` when a colon is present. `nftset_family` can be `inet` (dual-stack), `ip`, or `ip6`.

### `nftset_blacklist` and `nftset_whitelist`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Shorthand directives that enable nftset and configure one or more sets in a single line. `nftset_blacklist` registers sets as blocklist targets. `nftset_whitelist` sets allowlist mode.

```nginx
nftset_blacklist filter:spammers filter:hackers;
# Equivalent to: nftset on; nftset_sets filter:spammers filter:hackers; nftset_deny on;
```

### `nftset_sets`

- **Contexts:** `http`, `server`, `location`
- **Default:** none

Variadic OR matching across multiple nftables sets. The first matching set populates `$nftset_matched_set`. When configured, this overrides the single `nftset_table` / `nftset_set` pair.

```nginx
nftset_sets filter:spammers filter:hackers filter:tor_exits;
```

### `nftset_deny`

- **Contexts:** `http`, `server`, `location`
- **Default:** `on`

Controls the access mode. `on` means blocklist mode: IPs found in the set are denied. `off` means allowlist mode: IPs not found in the set are denied.

### `nftset_status`

- **Contexts:** `http`, `server`, `location`
- **Default:** `403`

HTTP status code returned when a request is blocked. Common values are `403`, `429`, `503`, and `444` (nginx connection close).

### `nftset_fail_open`

- **Contexts:** `http`, `server`, `location`
- **Default:** `off`

Controls behavior when the kernel lookup itself fails. `off` denies the request (fail closed, secure default). `on` lets the request through (fail open, prefers availability).

### `nftset_dryrun`

- **Contexts:** `http`, `server`, `location`
- **Default:** `off`

When turned on, the module logs what it would block but never actually blocks. The variable `$nftset_result` is set to `dryrun`. Use this to validate set membership before enabling enforcement.

### `nftset_cache_ttl`

- **Contexts:** `http`, `server`, `location`
- **Default:** `60s`

How long to cache the set membership result. The module uses a two-level cache: a per-worker hot cache (L1) and a shared-memory cross-worker cache (L2). Set to `0` to disable caching and force every request through the kernel lookup path.

### `nftset_autoadd`, `nftset_autoadd_table`, `nftset_autoadd_set`, and `nftset_autoadd_timeout`

- **Contexts:** `http`, `server`, `location`
- **Defaults:** `off`, inherits `nftset_table`, inherits `nftset_set`, `0`

Auto-add the current client IP to an nftables set during request handling. This is useful for honeypot flows and progressive blocking. Insertion is non-blocking: if it fails, the module logs the error but does not fail the request. The target set should be created with `flags dynamic`. Use `nftset_autoadd_timeout` to set a per-element expiry.

### `nftset_ratelimit_rate`, `nftset_ratelimit_burst`, and `nftset_ratelimit_status`

- **Contexts:** `http`, `server`, `location`
- **Defaults:** disabled, `0`, `429`

A simple fixed-window per-IP rate limiter. `nftset_ratelimit_rate` sets the allowed requests per second. `nftset_ratelimit_burst` allows extra requests within the window. Counting is shared across workers via nginx shared memory.

### `nftset_autoban_table`, `nftset_autoban_set`, and `nftset_autoban_timeout`

- **Contexts:** `http`, `server`, `location`
- **Defaults:** inherits `nftset_table`, disabled, `0`

When `nftset_autoban_set` is configured, an over-limit client IP is inserted into the specified nftables set automatically. This works with the rate limiter to provide temporary bans. The target set should support timeout semantics for automatic expiration.

### Exported variables

| Variable | Description |
|---|---|
| `$nftset_result` | `allow`, `deny`, `dryrun`, or `error` |
| `$nftset_matched_set` | `table:set` name of the matching set (multi-set mode only) |

## Works well with

- [Web Application Firewall](/docs/reference/modules/waf) for content-layer attack detection alongside IP-level blocking.
- [Rate Limiting](/docs/reference/modules/ratelimit) for threshold-based abuse control beyond simple set membership.
- [Dynamic Upstreams](/docs/reference/modules/dynamic-upstreams) when blocked clients should also be routed away from sensitive backends.
