---
title: Feature Flags (Rollout and Experimentation)
description: Feature flag evaluation with stable bucketing for gradual rollout, A/B testing, and canary releases in nginx. Deterministic per-identity assignment, no external process.
---

# Feature Flags (Rollout and Experimentation)

Use this module when you need to ship features safely, test ideas on a subset of traffic, and keep the same user on the same experience every time. Bucketing is a pure function of identity. No external process, no hidden state.

## When to use this module

- You want to roll out a feature gradually instead of flipping a switch for everyone at once.
- You need stable A/B or A/B/C assignment so the same user always sees the same variant.
- You want to force a specific user onto or off of a feature for testing, regardless of rollout percentage.
- You need routing-friendly outputs that feed into nginx variables via `js_set` or into policy decisions via `authz`.
- You want to read feature flag state from an `ngx.shared` dict for runtime toggle without config reloads.
- You need canary-aware rollout where the native canary module controls eligibility.
- You want session identity or OIDC subject claims to drive stable per-user bucketing.

## nginx.conf synthesis

### Boolean flag from nginx variables

The standard pattern: flag config comes from `set` directives. The handler reads them at request time.

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from feature_flags.js;

    server {
        listen 8888;

        location /flag/on {
            set $ff_name               "dark_mode";
            set $ff_key_type           "user_id";
            set $ff_key                $http_x_user_id;
            set $ff_dark_mode_enabled  "1";
            set $ff_dark_mode_pct      "25";
            js_content main.evaluate;
        }

        location /flag/off {
            set $ff_name               "dark_mode";
            set $ff_key_type           "user_id";
            set $ff_key                $http_x_user_id;
            set $ff_dark_mode_enabled  "0";
            set $ff_dark_mode_pct      "100";
            js_content main.evaluate;
        }
    }
}
```

The handler returns `"1"` when the flag is enabled for this request, `"0"` otherwise.

### Key types

Three bucket key types each produce their own stable domain so the same identifier maps to a different bucket per type.

```nginx
# By request ID (default when ff_key_type is unset)
set $ff_key_type "request_id";
set $ff_key      $arg_id;

# By user ID
set $ff_key_type "user_id";
set $ff_key      $http_x_user_id;

# By remote address
set $ff_key_type "remote_addr";
set $ff_key      $remote_addr;
```

### Override precedence

Force a flag on or off for a specific request, overriding the rollout percentage.

```nginx
location /flag/force-on {
    set $ff_name               "dark_mode";
    set $ff_key_type           "user_id";
    set $ff_key                $http_x_user_id;
    set $ff_dark_mode_enabled  "0";
    set $ff_dark_mode_pct      "0";
    set $ff_dark_mode_override "on";
    js_content main.evaluate;
}

location /flag/force-off {
    set $ff_name               "dark_mode";
    set $ff_key_type           "user_id";
    set $ff_key                $http_x_user_id;
    set $ff_dark_mode_enabled  "1";
    set $ff_dark_mode_pct      "100";
    set $ff_dark_mode_override "off";
    js_content main.evaluate;
}
```

Override takes precedence over the enabled flag and rollout percentage.

### Variant flags (A/B/C)

Weighted multi-variant selection. Each variant gets a percentage weight.

```nginx
location /flag/variant {
    set $ff_name               "experiment";
    set $ff_key_type           "user_id";
    set $ff_key                $http_x_user_id;
    set $ff_exp_enabled        "1";
    set $ff_exp_variants       "A:40,B:40,C:20";
    set $ff_exp_fallback       "control";
    js_content main.variant;
}
```

The handler returns the selected variant name (e.g. `"A"`). The same key always maps to the same variant.

### `js_set` for routing decisions

Evaluate a flag in variable context for conditional routing with `js_set`.

```nginx
http {
    js_import main from feature_flags.js;
    js_set $dark_mode_enabled main.evaluate_js_set;

    server {
        listen 8888;

        location /route {
            set $ff_name               "dark_mode";
            set $ff_key_type           "user_id";
            set $ff_key                $http_x_user_id;
            set $ff_dark_mode_enabled  "1";
            set $ff_dark_mode_pct      "50";

            # $dark_mode_enabled resolves to "1" or "0" via the js_set handler
            add_header X-Dark-Mode $dark_mode_enabled;
            return 200 "ok";
        }
    }
}
```

### Runtime state via shared dict

Toggle flags at runtime without nginx reload by persisting config to `ngx.shared`.

```nginx
http {
    js_shared_dict_zone zone=ff_state:1m timeout=1h;
    js_import main from feature_flags.js;

    server {
        listen 8888;

        # Persist a flag: ?name=dark_mode&enabled=1&pct=50&ttl=3600
        location /set-flag {
            set $ff_state_dict ff_state;
            js_content main.set_flag;
        }

        # Evaluate: tries shared dict first, falls back to nginx vars
        location /evaluate {
            set $ff_name       dark_mode;
            set $ff_state_dict ff_state;
            set $ff_key_type   user_id;
            set $ff_key        user_42;
            js_content main.evaluate;
        }
    }
}
```

When the shared dict has no entry for the flag name, the handler falls back to nginx variable config. Zero config change needed for existing deployments.

### OIDC subject key type

Use the OIDC subject claim for stable per-user bucketing. Reads from the `$ff_oidc_sub` bridge variable or falls back to native `$oidc_claim_sub`.

```nginx
location /flag/oidc {
    set $ff_name         "dark_mode";
    set $ff_key_type     "oidc_sub";
    set $ff_oidc_sub     $http_x_oidc_sub;
    set $ff_key          $http_x_oidc_sub;
    set $ff_dark_mode_enabled "1";
    set $ff_dark_mode_pct     "100";
    js_content main.evaluate;
}
```

### Session-backed key type

Use session subject as the bucket key. Falls back to request key when the session cookie is missing or invalid.

```nginx
http {
    js_shared_dict_zone zone=sessions:1m timeout=1h;
    js_import main from feature_flags.js;
    js_import session_main from session.js;

    server {
        listen 8888;

        set $session_dict sessions;
        set $session_ttl 3600;

        location /start {
            set $session_subject $arg_subject;
            js_content session_main.start;
        }

        location /bucket/session {
            set $ff_key_type session;
            set $ff_key fallback-42;
            js_content main.bucket;
        }
    }
}
```

### Canary-aware evaluation

When the native canary module sets `$ngz_canary`, treat canary traffic as force-on without disturbing the normal evaluate path.

```nginx
location /flag/canary {
    set $ff_name               "dark_mode";
    set $ff_key_type           "user_id";
    set $ff_key                $http_x_user_id;
    set $ff_dark_mode_enabled  "1";
    set $ff_dark_mode_pct      "25";
    js_content main.evaluate_canary;
}
```

`main.evaluate_canary` reads `$ngz_canary` and maps canary (true) to `ForceOn`. The `describe_canary` handler annotates the decision with `canary=1|0`.

### Decision metadata

Get structured flag evaluation output for logging or debugging.

```nginx
location /flag/describe {
    set $ff_name               "dark_mode";
    set $ff_key_type           "user_id";
    set $ff_key                $http_x_user_id;
    set $ff_dark_mode_enabled  "1";
    set $ff_dark_mode_pct      "100";
    js_content main.describe;
}

location /flag/describe-variant {
    set $ff_name               "experiment";
    set $ff_key_type           "user_id";
    set $ff_key                $http_x_user_id;
    set $ff_exp_enabled        "1";
    set $ff_exp_variants       "A:40,B:40,C:20";
    set $ff_exp_fallback       "control";
    js_content main.describe_variant;
}
```

## Public Gleam API

The module source lives in `modules/feature_flags/src/`. All handlers are registered through a single `exports()` function.

### `nginz_njs_feature_flags.exports()` (the nginx adapter)

Returns a JavaScript object mapping handler names to functions for `js_import`.

Exported handlers:

| Handler              | Type      | Behavior |
|----------------------|-----------|----------|
| `evaluate`           | sync      | Boolean flag evaluation. Checks shared dict first, falls back to nginx vars. Returns `"1"` or `"0"`. |
| `evaluate_js_set`    | sync      | Same as evaluate but compatible with `js_set` (returns string, not response). |
| `evaluate_canary`    | sync      | Evaluate with `$ngz_canary` as override source. |
| `variant`            | sync      | Weighted multi-variant selection. Returns the selected variant name. |
| `describe`           | sync      | Boolean flag decision metadata string. |
| `describe_variant`   | sync      | Variant flag decision metadata string. |
| `describe_canary`    | sync      | Boolean decision metadata annotated with `canary=0|1`. |
| `bucket`             | sync      | Returns the raw 0-99 bucket number for the resolved key. |
| `set_flag`           | sync      | Persists flag config to shared dict from query params (`?name=&enabled=&pct=`). |

### `feature_flags/evaluation`

The pure evaluation core. No side effects, fully unit-testable without nginx.

**Types:**

- `Flag(name, enabled, rollout_pct)` -- boolean flag descriptor
- `BucketKey` -- `ByRequestId(id)` | `ByUserId(uid)` | `ByRemoteAddr(addr)`
- `Override` -- `NoOverride` | `ForceOn` | `ForceOff`
- `Variant(name)` -- a named variant
- `VariantConfig(name, weight)` -- weighted variant configuration
- `VariantFlag(name, enabled, variants, fallback)` -- variant flag descriptor
- `BooleanDecision` -- structured boolean flag decision
- `VariantDecision` -- structured variant flag decision

**Evaluation:**

- `evaluate(flag, key, override)` -- full boolean evaluation; override takes precedence
- `is_enabled(flag, key)` -- shorthand for `enabled && bucket(key) < rollout_pct`
- `bucket(key)` -- FNV-1a 32-bit hash mod 100; stable, uniform per key-type domain
- `select_variant(flag, key, override)` -- weight-based variant selection
- `describe_boolean(flag, key, override)` -- produces a structured `BooleanDecision`
- `describe_variant(flag, key, override)` -- produces a structured `VariantDecision`

**Config parsing:**

- `parse_enabled(raw)` -- parses `"1"` / `"0"` to Bool
- `parse_rollout_pct(raw)` -- parses string percentage to Int (clamped 0-100)
- `parse_override(raw)` -- parses `"on"` / `"off"` to Override
- `parse_variant_configs(raw)` -- parses `"A:40,B:40,C:20"` to `List(VariantConfig)`

### `feature_flags/state`

- `load(dict_name, flag_name)` -- reads flag config from `ngx.shared`; returns `Error(Nil)` on miss
- `save(dict_name, flag, ttl_s)` -- persists flag config to `ngx.shared`

### `feature_flags/metrics`

- `boolean_decision(flag, key, enabled)` -- counter metric for boolean flag outcomes
- `variant_selection(flag, key, variant, is_fallback)` -- counter metric for variant outcomes

### `feature_flags/canary`

- `canary_flag_to_override(Bool)` -- maps canary routing decision to ForceOn or NoOverride
- `annotate_decision(description, is_canary)` -- appends `canary=1|0` to decision output
- `read_canary(r)` -- reads `$ngz_canary` set by native canary module (False when absent)
- `canary_to_override(r)` -- composes the above: read canary and produce the override

### `feature_flags/identity`

- `claim_to_key(value, fallback)` -- non-empty becomes `ByUserId`, empty becomes `ByRequestId(fallback)`
- `from_oidc_subject(vars, fallback)` -- reads `$ff_oidc_sub` bridge variable first, falls back to native `$oidc_claim_sub`, then `ByRequestId(fallback)`
- `from_jwt_claim(vars, claim, fallback)` -- reads `$ff_jwt_<claim>` bridge variable

## Works well with

- [Session](/docs/reference/scripted-modules/session) for session-backed bucket key resolution and sticky rollout assignment.
- [Authz](/docs/reference/scripted-modules/authz) when flag decisions need to feed into authorization policy rules.
- [OpenID Connect](/docs/reference/modules/oidc) when OIDC subject claims drive stable per-user flag targeting.
- [Canary](/docs/reference/modules/canary) for native canary routing that feeds into feature flag overrides.
- [NJS Orchestration](/docs/reference/modules/njs) for custom orchestration that reads flag decisions and routes traffic accordingly.
