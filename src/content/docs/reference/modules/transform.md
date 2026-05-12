---
title: JSON Response Transform
description: Extract a specific JSON sub-path from upstream responses. Useful for trimming API responses down to the data your clients actually need.
---

# JSON Response Transform

Use this module when an upstream returns more JSON than you want to forward to the client. It extracts a single path from the response body using JSONPath-style syntax and sends only that value downstream.

## When to use this module

- Your upstream API wraps data in envelope fields (`data`, `result`, `response`) that clients should not see.
- You want to extract a specific nested value (like a count or a single array element) and return it directly.
- You need to reshape upstream JSON responses without changing backend code or adding a proxy layer.

## nginx.conf synthesis

```nginx
location /api/users {
    proxy_pass http://backend/users;
    transform_response $.data;
}

location /api/count {
    proxy_pass http://backend/stats;
    transform_response $.data.total;
}

location /api/first-item {
    proxy_pass http://backend/items;
    transform_response $.items.0;
}
```

## Examples

Given this upstream response:

```json
{
  "status": "ok",
  "data": {
    "users": [
      {"id": 1, "name": "Alice"},
      {"id": 2, "name": "Bob"}
    ],
    "total": 2
  }
}
```

- `transform_response $.data` returns the full `data` object.
- `transform_response $.data.users` returns the users array.
- `transform_response $.data.total` returns the number `2`.

## Path syntax

| Pattern | What it selects |
|---------|-----------------|
| `$.foo` | Root-level field `foo` |
| `$.foo.bar` | Nested field `bar` inside `foo` |
| `$.items.0` | First element of the `items` array (0-based) |
| `$.data.items.0.name` | Deeply nested field with array access |

## Directive reference

### `transform_response`

- **Contexts:** `location`
- **Default:** none

Takes a JSON path expression and extracts that sub-path from the upstream response body. Must be used in a location that also has a `proxy_pass` or other upstream directive.

## Behavior notes

- Non-JSON responses (missing `application/json` content-type) pass through unchanged.
- If the path does not exist in the response, the original response is returned.
- If JSON parsing fails, the original response is returned.

## Limitations

- Only simple dot-delimited paths with numeric array indices. No array filters, wildcards, or recursive descent.
- The full response is buffered in memory before transformation.
- Request bodies are not transformed.

## Works well with

- Stock nginx `sub_filter` — use transform for JSON path extraction and `sub_filter` for plain text replacement; they solve complementary problems.
- Stock nginx `proxy_set_header` — strip upstream headers that clients shouldn't see when reshaping responses.
- [Echoz](/docs/reference/modules/echoz) for testing transforms against known response shapes.
- [Circuit Breaker](/docs/reference/modules/circuit-breaker) for protecting upstreams that serve the data you are transforming.
- [Cache Purge](/docs/reference/modules/cache-purge) when transformed responses are cached and need invalidation.
