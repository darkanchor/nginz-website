---
title: GraphQL Gateway
description: Validate GraphQL requests at the edge by enforcing depth limits and introspection policy before traffic reaches the app.
---

# GraphQL Gateway

Use this module when your GraphQL endpoint should reject obviously unsafe or production-forbidden queries before they hit the backend.

## When to use this module

- You want to cap query depth to protect the backend from deeply nested requests.
- You want to disable introspection on production endpoints.
- You need a lightweight GraphQL validation layer without a full gateway product.
- You want invalid GraphQL requests rejected in nginx with clear JSON errors.

## nginx.conf synthesis

Enable the module on the GraphQL route and set the depth and introspection policy.

```nginx
location /graphql {
    graphql on;
    graphql_max_depth 5;
    graphql_introspection off;
    proxy_pass http://graphql_backend;
}
```

This keeps normal requests flowing to the backend while blocking requests that violate the configured policy.

## Directive reference

### `graphql`

- **Contexts:** `location`
- **Default:** `off`

Turns GraphQL validation on for the location. Without this, nginx passes requests through without GraphQL-specific checks.

### `graphql_max_depth`

- **Contexts:** `location`
- **Default:** `10`

Sets the maximum allowed nesting depth for GraphQL queries. Lower values reduce backend risk but may block legitimate complex queries.

### `graphql_introspection`

- **Contexts:** `location`
- **Default:** `on`

Controls whether introspection requests are allowed. Turn it off on public production endpoints when schema exploration should be blocked.

## Works well with

- **JWT Authentication** or **OpenID Connect** when your GraphQL API is protected.
- **Rate Limiting** for abuse control beyond depth checks.
- **Web Application Firewall** for broader request inspection around the GraphQL route.
