---
title: Dynamic Upstreams
description: Change the active upstream peer set at runtime without a full nginx reload.
---

# Dynamic Upstreams

Use this module when backend membership changes more often than you want to reload nginx.

## When to use this module

- You need to add, remove, or replace upstream peers while nginx stays live.
- You want an operational API for upstream membership.
- You pull backend membership from a static JSON file or from Consul.
- You need runtime changes without in-place peer mutation risk.

## nginx.conf synthesis

Mark the upstream as managed, then expose an API location that targets it.

```nginx
upstream api_backend {
    dynamic_upstreams_managed;
    server 10.0.0.11:8080;
    server 10.0.0.12:8080;
}

location /api/upstreams {
    dynamic_upstreams_api;
    dynamic_upstreams_target api_backend;
    dynamic_upstreams_source consul;
    dynamic_upstreams_consul_address 127.0.0.1:8500;
    dynamic_upstreams_consul_service api-backend;
    dynamic_upstreams_refresh 5000;
}
```

This gives you a control surface that reads and updates a named upstream through immutable snapshot activation.

## Directive reference

### `dynamic_upstreams_managed`

- **Contexts:** `upstream`
- **Default:** disabled

Marks an upstream as eligible for runtime snapshot management. Without this, the control plane has nothing to update.

### `dynamic_upstreams_api`

- **Contexts:** `location`
- **Default:** disabled

Turns the location into the runtime control endpoint. This is the route that serves read and write operations for the upstream state.

### `dynamic_upstreams_source`

- **Contexts:** `location`
- **Default:** `static`

Chooses where the runtime membership comes from. Use `static` for a local file source and `consul` for service-discovery-driven membership.

### `dynamic_upstreams_source_file`

- **Contexts:** `location`
- **Default:** none

Points the module at the JSON snapshot file used in static mode. Use it when operations or deployment tooling writes peer sets to disk.

### `dynamic_upstreams_target`

- **Contexts:** `location`
- **Default:** none

Names the upstream group the API controls. This is required so the location cannot accidentally act on the wrong upstream.

### `dynamic_upstreams_refresh`

- **Contexts:** `location`
- **Default:** none / no background refresh

Sets how often the source is polled when using background reconciliation. Lower values give fresher state; higher values reduce control-plane churn.

### `dynamic_upstreams_worker_events_channel`

- **Contexts:** `location`
- **Default:** none

Names the channel used for activation and refresh notifications. Notifications are published only when this and `dynamic_upstreams_worker_events_zone` are both configured.

### `dynamic_upstreams_worker_events_zone`

- **Contexts:** `location`
- **Default:** none

Selects the explicitly named worker-events shared-memory zone for snapshot activation, restoration, drain, and refresh-failure notifications. Pair it with `dynamic_upstreams_worker_events_channel` to avoid ambiguous routing in configurations with multiple event zones.

### `dynamic_upstreams_consul_address`

- **Contexts:** `location`
- **Default:** none

Defines which Consul agent to query in `consul` source mode. The current implementation expects an IP literal and port.

### `dynamic_upstreams_consul_service`

- **Contexts:** `location`
- **Default:** none

Names the Consul service whose healthy instances become the upstream peer set.

### `dynamic_upstreams_consul_tag`

- **Contexts:** `location`
- **Default:** none

Filters discovered Consul instances by tag. Use it to keep the peer set aligned with environment or role labels.

### `dynamic_upstreams_consul_token`

- **Contexts:** `location`
- **Default:** none

Adds the ACL token needed for protected Consul APIs.

### `dynamic_upstreams_consul_dc`

- **Contexts:** `location`
- **Default:** none

Queries a specific Consul datacenter. Use it when the source of truth must come from a named region.

## Works well with

- Stock nginx `upstream` blocks — dynamic-upstreams replaces static server lists with runtime-managed snapshots.
- [Upstream Balancer](/docs/reference/modules/upstream-balancer) because it consumes the runtime peer graph at request time.
- [Health Checks](/docs/reference/modules/healthcheck) because unhealthy peers can be kept out of activation.
- [Worker Events](/docs/reference/modules/worker-events) for snapshot activation and refresh-failure notifications.
- [Consul Integration](/docs/reference/modules/consul) when service discovery is the upstream source of truth.
