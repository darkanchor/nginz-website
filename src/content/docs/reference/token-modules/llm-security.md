---
title: llm-security
description: Prompt-side inspection and policy enforcement for PII, secrets, and prompt injection patterns, with org/project policy layering and response redaction.
---

# llm-security

Use this module when the gateway must inspect prompts or responses for policy violations, block disallowed traffic before provider send, or redact unsafe output without exposing raw violation material to logs or downstream metrics.

## When to use this module

- You need to detect prompt injection, PII, secrets, or policy violations in LLM request bodies before they reach upstream providers.
- You want to block violating requests before upstream send (saving provider costs and preventing data leakage).
- You need response-side inspection and redaction — replacing matched patterns with `[REDACTED]` while preserving JSON structure.
- You need org/project policy layering: an org baseline with project-level additive/strengthening rules.
- You want per-rule action overrides: some rules detect-only while others block or redact.
- You need audit-safe outcomes: rule IDs and actions are surfaced without leaking the matched content.
- You want native-path and translated-path requests to be equally enforceable.

## nginx.conf synthesis

Request-only detect mode with a rules file.

```nginx
location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_security;
    llm_security_mode detect;
    llm_security_rules_file /etc/nginx/security/rules.txt;

    proxy_pass https://$llm_provider_upstream;
}
```

Redact mode with response inspection and redaction.

```nginx
location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_security;
    llm_security_mode redact;
    llm_security_rules_file /etc/nginx/security/rules.txt;
    llm_security_inspect_response on;
    llm_security_reject_oversized_request on;
    llm_security_reject_oversized_response on;

    proxy_pass https://$llm_provider_upstream;
}
```

Org/project layered policy with per-rule actions and audit-safe observability.

```nginx
location /v1 {
    llm_proxy;
    llm_proxy_route openai    openai_upstream;
    llm_proxy_route anthropic anthropic_upstream anthropic;
    llm_proxy_default_provider openai;

    llm_auth;
    llm_auth_org $http_x_org_id;
    llm_auth_project $http_x_project_id;

    llm_security;
    llm_security_mode block;
    llm_security_org_rules_file /etc/nginx/security/org-baseline.txt;
    llm_security_project_rules_file /etc/nginx/security/project-overrides.txt;
    llm_security_org $llm_auth_org;
    llm_security_project $llm_auth_project;

    # Expose non-secret security outcomes as headers
    add_header X-Security-Detected $llm_security_detected always;
    add_header X-Security-Rule-Id $llm_security_rule_id always;
    add_header X-Security-Action $llm_security_action always;

    proxy_pass https://$llm_provider_upstream;
}
```

## Rules file format

```
RULE_ID:literal_pattern
RULE_ID|detect:literal_pattern
RULE_ID|block:literal_pattern
RULE_ID|redact:literal_pattern
```

When the `|action` segment is omitted, the location's `llm_security_mode` supplies the default action.

## Directive reference

### Core directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_security` | `location` | — | Enable security policy for this location. |
| `llm_security_mode` | `location` | — | Enforcement mode: `detect`, `block`, or `redact`. `redact` requires `llm_security_inspect_response on`. |
| `llm_security_rules_file` | `location` | — | Path to the rules file. Parsed at startup. |
| `llm_security_reject_oversized_request` | `location` | `on` | Reject request bodies above `llm_proxy_max_body_size` with `413` before provider send instead of passing them through without inspection. Omission is valid; set `off` only as an explicit compatibility escape hatch. Fixed-length and chunked bodies are covered. |

### Response inspection directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_security_inspect_response` | `location` | `off` | Enable response-side inspection and redaction. Required for `llm_security_mode redact`. |
| `llm_security_reject_oversized_response` | `location` | `on` | Stop a buffered response that grows beyond `llm_proxy_max_response_size` before buffered body bytes are emitted. Omission is valid; set `off` only as an explicit compatibility escape hatch. A late or chunked overflow may close the client connection because response headers may already have entered nginx's filter chain. |

### Policy layering directives

| Directive | Contexts | Default | Description |
|---|---|---|---|
| `llm_security_org_rules_file` | `location` | — | Path to the mandatory org baseline rules file. Project rules may strengthen but never weaken org rules. |
| `llm_security_project_rules_file` | `location` | — | Path to optional project rules. May add new rule IDs or strengthen an inherited org rule's action. |
| `llm_security_org` | `location` | — | nginx variable surfaced as `$llm_security_org` for audit-safe observability. |
| `llm_security_project` | `location` | — | nginx variable surfaced as `$llm_security_project` for audit-safe observability. |
| `llm_security_fail_closed` | `location` | `off` | When `on`, blocks requests when rule loading or inspection fails internally. |

## Exported variables

| Variable | Description |
|---|---|
| `$llm_security_detected` | `0`/`1` — whether a violation was detected. |
| `$llm_security_blocked` | `0`/`1` — whether the request was blocked. |
| `$llm_security_rule_id` | Stable non-secret rule identifier for the strongest match. |
| `$llm_security_action` | Action taken: `detect`, `block`, `redact`, or `none`. |
| `$llm_security_response_detected` | `0`/`1` — whether a response-side violation was detected. |
| `$llm_security_response_blocked` | `0`/`1` — whether the response was blocked. |
| `$llm_security_response_rule_id` | Stable non-secret rule identifier for the strongest response-side match. |
| `$llm_security_inspection_path` | `native` or `translated` — whether the request had translation applied before inspection. |
| `$llm_security_org` | Org identifier from `llm_security_org`. |
| `$llm_security_project` | Project identifier from `llm_security_project`. |
| `$llm_security_policy_source` | Rule-set source label: `legacy`, `org`, or `org+project`. |

## Behavior notes

- Request-side inspection runs after canonical request parsing but before upstream send. Blocked requests return 403 before contacting the provider.
- `llm_security_mode block` with `llm_security_inspect_response on` is rejected at config load time — response-body blocking needs header-buffering substrate that does not exist yet.
- `redact` mode on request bodies is canonicalized to `block` (redaction of the outgoing request body is not meaningful — the request is blocked instead).
- Response-side inspection runs on buffered non-streaming response bodies. Streaming (SSE) response redaction is not yet implemented.
- Oversized request and response rejection are opt-in. Omitting either directive preserves the existing pass-through behavior and remains valid configuration.
- Size enforcement uses `llm_proxy_max_body_size` and `llm_proxy_max_response_size`; keep those limits aligned with the largest payloads your policy is expected to inspect.
- Content-Length is cleared in the header filter when redact mode may change the body length.
- Redacted matches are replaced with `[REDACTED]` in-place, preserving JSON parseability.
- Only the strongest single match is recorded. Bodies that violate multiple rules surface only one `rule_id`/`action`.
- Policy layering: org rules are the mandatory baseline. Project rules may add new rule IDs or strengthen an inherited org rule's action (detect → block → redact). Project rules may not weaken org rules. Same-`rule_id` project overrides must keep the org pattern exactly; narrower patterns must use a new rule ID. Mixed layered rules report `$llm_security_policy_source = org+project`.
- Matching is ASCII case-insensitive. Non-ASCII confusable characters and separator insertion may bypass literal rules — the module is not Unicode-aware.
- Request-side `redact` action is canonicalized to `block`. The `$llm_security_action` variable reports `block` in this case.
