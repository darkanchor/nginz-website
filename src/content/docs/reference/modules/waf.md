---
title: Web Application Firewall
description: Detect and block SQL injection, cross-site scripting, and custom attack patterns at the nginx layer with built-in and file-driven rules.
---

# Web Application Firewall

Use this module when you want to inspect requests for common web attacks before they reach your application, without adding a separate WAF appliance or reverse proxy.

## When to use this module

- You want SQL injection and XSS detection at the edge, before traffic reaches your application servers.
- You need a detection-only mode to evaluate WAF rules before enabling enforcement.
- You want to write custom security rules using a ModSecurity-like syntax in a plain text file.
- You need request body inspection for POST, PUT, and PATCH endpoints.
- You want temporary IP bans or score-based blocking for clients that trigger repeated WAF events.
- You need visibility into WAF decisions through exported nginx variables.

## nginx.conf synthesis

### Block SQLi and XSS with body inspection

```nginx
location /api {
    waf on;
    waf_mode block;
    waf_sqli on;
    waf_xss on;
    waf_check_body on;

    proxy_pass http://backend;
}
```

### Detection-only mode

Log what would be blocked without disrupting traffic.

```nginx
location /legacy {
    waf on;
    waf_mode detect;

    proxy_pass http://legacy-backend;
}
```

### Custom rules file

Disable the built-in patterns and use your own rule set.

```nginx
location /api {
    waf on;
    waf_mode block;
    waf_sqli off;
    waf_xss off;
    waf_rules_file /etc/nginz/waf/custom.rules;
}
```

Example rule file:

```text
SecRule ARGS "@contains union select" "id:1001,phase:1,msg:'SQLi needle'"
SecRule REQUEST_BODY "@contains <script" "id:1002,phase:2,msg:'body XSS needle'"
SecRule REQUEST_HEADERS:User-Agent "@contains bot" "id:1003,phase:1,msg:'blocked user agent'"
SecRule ARGS:attempts "@ge 5" "id:1004,phase:1,msg:'too many attempts'"
```

## Directive reference

### `waf`

- **Contexts:** `location`
- **Default:** `off`

Enables the WAF for this location. When turned on, the module inspects requests using built-in patterns and any custom rules you provide.

### `waf_mode`

- **Contexts:** `location`
- **Default:** `block`

Controls whether the WAF enforces or only observes. `block` returns a 403 with a JSON error body when an attack is detected. `detect` logs the detection but lets the request pass through.

### `waf_sqli` and `waf_xss`

- **Contexts:** `location`
- **Default:** `on` (both)

Toggle SQL injection and cross-site scripting detection independently. The module URL-decodes input, then runs libinjection, and falls back to native substring signatures. Turn off either check if your application uses patterns that trigger false positives.

### `waf_check_body`

- **Contexts:** `location`
- **Default:** `off`

Enables request body inspection for POST, PUT, and PATCH requests. Body inspection is limited to the first 8 KB of content for performance.

### `waf_rules_file`

- **Contexts:** `location`
- **Default:** none

Loads a custom rule file at configuration time. The file contains one `SecRule` per line using a ModSecurity-like syntax. Supported targets include `REQUEST_URI`, `ARGS`, `QUERY_STRING`, `REQUEST_BODY`, `REQUEST_HEADERS`, `REQUEST_COOKIES`, `REQUEST_METHOD`, `REMOTE_ADDR`, and more. Operators include `@contains`, `@rx`, `@pm`, `@beginsWith`, `@endsWith`, `@streq`, `@ipMatch`, `@libinjection_sqli`, `@libinjection_xss`, and others.

Each rule can specify actions like `id:`, `phase:`, `msg:`, `score:`, `deny`, `pass`, `log`, `status:`, and transformations like `t:lowercase` and `t:urlDecode`.

### `waf_ban_threshold`, `waf_ban_window`, and `waf_ban_duration`

- **Contexts:** `location`
- **Defaults:** `0`, `60`, `300`

Enable temporary IP bans after a threshold of WAF detections. `waf_ban_window` sets the counting window in seconds. `waf_ban_duration` sets how long the ban lasts. Repeat offenders receive escalating ban durations.

```nginx
waf_ban_threshold 5;
waf_ban_window    60;
waf_ban_duration  300;
```

### `waf_score_threshold` and `waf_score_decay_window`

- **Contexts:** `location`
- **Defaults:** `0`, `60`

Enable score-based banning. Each WAF detection increments the client's accumulated score. When the score reaches `waf_score_threshold`, the client is temporarily banned. The score decays during quiet periods based on `waf_score_decay_window`.

```nginx
waf_score_threshold 10;
waf_score_decay_window 120;
```

### Exported variables

| Variable | Description |
|---|---|
| `$waf_result` | `allowed`, `denied`, or `dryrun` |
| `$waf_rule_id` | Numeric ID of the matched custom rule (empty for built-in matches) |
| `$waf_score` | Current accumulated threat score for the client IP |
| `$waf_category` | `sqli`, `xss`, `ban`, `rule`, or empty |

These variables let you log WAF decisions, inject them into upstream headers, or compose them with other modules for unified access policies.

## Works well with

- [JWT Authentication](/docs/reference/modules/jwt) for layered API security.
- [OpenID Connect](/docs/reference/modules/oidc) when authenticated applications also need attack detection.
- [nftables IP Policy](/docs/reference/modules/nftset) for kernel-level IP blocking of repeat WAF offenders.
- [Rate Limiting](/docs/reference/modules/ratelimit) for traffic volume controls alongside content inspection.
