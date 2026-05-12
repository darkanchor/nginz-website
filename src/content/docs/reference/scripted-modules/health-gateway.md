---
title: Health Gateway
description: Deferred health aggregation building block. Intended to combine multi-source health signals into policy-relevant readiness decisions when native surfaces alone are not enough.
---

# Health Gateway

**Status: deferred by design.** This module is not part of the current active package set. The native `healthcheck` module already exposes readiness, liveness, and backend-count facts directly through `$health_*` variables. A scripted health aggregation layer becomes justified only when you need multi-source health decisions that the native surface cannot already express cleanly.

## When to use this module

Do not use this module today. The native health surface covers the common cases well. Revisit this module only when at least one of these conditions becomes concrete for your deployment:

- You need multi-source health aggregation across native `healthcheck`, service discovery, cache state, and scripted policy inputs.
- You need custom readiness semantics that combine health with rollout, session, or policy context.
- You need cache-backed stale and refresh behavior that native health endpoints do not already cover.
- You need routing decisions that genuinely require a reusable `AggregateStatus` or `GateDecision` library beyond simple native readiness variables.

## Intended role

When revived, this module is meant to combine several health signals into one answer that nginx can act on. The core library ideas that survive conceptually are:

| Concept | Description |
|---|---|
| `AggregateStatus` | Combined health state from multiple sources |
| `GateDecision` | Policy-relevant readiness outcome (allow, deny, degrade) |
| Health response rendering | Reusable JSON and text health output |
| Aggregation interfaces | Pluggable signal combination and caching |

The module would compose with native health variables, service discovery signals, and runtime policy rather than duplicating what `healthcheck` already does.

### What does not change

The native `$health_*` variables are stable and fully supported for baseline readiness and liveness work. You should use them directly in your nginx configuration. This module does not replace or deprecate the native health surface.

## nginx.conf synthesis

This module has no nginx handlers today. When revived, a typical configuration would look similar to:

```nginx
http {
    js_engine qjs;
    js_path "njs/";
    js_import main from app.js;

    server {
        listen 8888;

        # Future: aggregated health endpoint
        location /health/aggregated {
            js_content main.aggregate;
        }
    }
}
```

The exact handler contract is not yet defined. The example above is illustrative of the direction but should not be treated as a supported API.

## Public Gleam API

There is no public API to consume today. The deferred library surface would likely include:

- `AggregateStatus` type for combined multi-source health state
- `GateDecision` type for policy-relevant readiness outcomes
- Composable aggregation functions that merge native `$health_*` facts with scripted policy inputs

This section will be filled when a real consumer proves the package boundary.

## Works well with

- [Health Checks](/docs/reference/modules/healthcheck) (native) for baseline readiness and liveness variables. Use `$health_*` directly for all current health needs.
- [Canary Routing](/docs/reference/modules/canary) (native) for combining health with rollout state in routing decisions.
- [MLCache](/docs/reference/scripted-modules/mlcache) for caching aggregated health state with stale and refresh semantics.
- [Control API](/docs/reference/scripted-modules/control-api) for surfacing aggregated health state through the operator surface when the module is revived.
