---
title: Consul Integration
description: Read service discovery and key-value data from HashiCorp Consul through nginx routes.
---

# Consul Integration

Use this module when nginx needs to read live service or configuration data from Consul without handing that responsibility to application code.

## When to use this module

- You want nginx to discover healthy service instances from Consul.
- You need simple runtime configuration reads from the Consul KV store.
- You want a lightweight catalog or health lookup API at the edge.
- You use Consul as a discovery source for dynamic upstream control.

## nginx.conf synthesis

Expose separate routes for service lookup, KV lookup, or catalog listing depending on what you need.

```nginx
location /services/ {
    consul_services 127.0.0.1:8500;
}

location /config/timeout {
    consul_kv 127.0.0.1:8500;
    consul_key config/app/timeout;
}

location /catalog {
    consul_catalog 127.0.0.1:8500;
}
```

This keeps the Consul interaction at the proxy layer and returns JSON that other routes or modules can consume.

## Directive reference

### `consul_services`

- **Contexts:** `location`
- **Default:** disabled

Turns the location into a service discovery endpoint. The module queries Consul for healthy instances of the selected service.

### `consul_kv`

- **Contexts:** `location`
- **Default:** disabled

Turns the location into a key-value lookup endpoint. Use it when nginx needs to read one configuration value at request time.

### `consul_catalog`

- **Contexts:** `location`
- **Default:** disabled

Returns the list of registered service names from Consul. This is useful for inventory and diagnostics rather than hot request paths.

### `consul_service`

- **Contexts:** `location`
- **Default:** service name derived from URI

Pins the location to one service name instead of deriving it from the path. Use it for stable service lookup endpoints.

### `consul_key`

- **Contexts:** `location`
- **Default:** key derived from URI

Pins the location to one KV key. Use it when you want a stable config endpoint instead of a dynamic path-based lookup.

### `consul_tag`

- **Contexts:** `location`
- **Default:** none

Filters service discovery results by Consul tag. This is useful for environment, version, or traffic-class scoping.

### `consul_dc`

- **Contexts:** `location`
- **Default:** local default datacenter

Queries a specific datacenter instead of the default one. Use it when your routing policy needs an explicit Consul region.

### `consul_token`

- **Contexts:** `location`
- **Default:** none

Adds the ACL token required by secured Consul environments. Set it anywhere the module must talk to a protected Consul API.

## Works well with

- Stock nginx `resolver` and upstream blocks — use these for DNS-based discovery; Consul adds service-level health filtering and KV configuration.
- **Dynamic Upstreams** because it can use Consul as a live discovery source.
- **Health Checks** when discovered services still need readiness verification before traffic shifts.
- **njs Runtime** for higher-level orchestration that combines KV and service discovery results.
