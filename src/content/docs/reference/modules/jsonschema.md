---
title: JSON Schema Validation
description: Validate JSON request bodies against inline JSON Schema definitions in the access phase, before requests reach your backend.
---

# JSON Schema Validation

Use this module when you want to reject malformed request payloads at the edge based on a JSON Schema you define inline, without writing any application code.

## When to use this module

- You accept JSON payloads and want to enforce structure, types, and constraints before they hit your backend.
- You want to reject bad requests early with a clear `400` response, saving upstream services from parsing garbage.
- You need basic schema validation (type checks, required fields, string lengths, numeric ranges) and do not want to add a schema library to every service.

## nginx.conf synthesis

```nginx
location /api/users {
    jsonschema '{"type":"object","required":["name","email"],"properties":{"name":{"type":"string","minLength":1},"email":{"type":"string"},"age":{"type":"number","minimum":0}}}';
    jsonschema_body_max_size 1m;
    proxy_pass http://backend;
}
```

The module only validates `POST`, `PUT`, and `PATCH` requests with `Content-Type: application/json`. GET requests, other methods, requests without the JSON content type, and empty bodies pass through without validation.

On failure the response is `400` with a JSON body:

```json
{
  "error": "validation_failed",
  "message": "missing required field"
}
```

## Directive reference

### `jsonschema`

- **Contexts:** `location`
- **Default:** none

Takes an inline JSON Schema string as its argument. Validates request bodies in the access phase against that schema. Only applies to `POST`, `PUT`, and `PATCH` with `Content-Type: application/json`.

### `jsonschema_body_max_size`

- **Contexts:** `location`
- **Default:** `1m`

Sets the largest JSON request body that may be buffered for schema validation. Larger declared or accumulated bodies return HTTP 413. File-backed bodies are rejected explicitly rather than bypassing validation or being copied without a bound.

## Supported schema keywords

| Keyword | What it checks |
|---------|----------------|
| `type` | `string`, `number`, `integer`, `boolean`, `object`, `array`, `null` |
| `required` | Array of required property names for objects |
| `properties` | Nested schema definitions for each property |
| `minLength` / `maxLength` | Minimum and maximum string length |
| `minimum` / `maximum` | Minimum and maximum numeric value |

## Error messages

| Message | Meaning |
|---------|---------|
| `invalid JSON` | Request body could not be parsed |
| `must be a string` / `must be a number` / etc. | Type mismatch on a field |
| `missing required field` | A required field is absent |
| `string too short` / `string too long` | String length outside bounds |
| `number below minimum` / `number above maximum` | Numeric value outside bounds |
| `schema too deep` | Schema nesting exceeds 100 levels |

## Works well with

- Stock nginx `proxy_pass` — validate payloads at the edge before forwarding to your backend.
- [Echoz](/docs/reference/modules/echoz) for testing validation rules with a local echo endpoint.
- [JWT Authentication](/docs/reference/modules/jwt) when you want to validate both the token and the payload shape at the edge.
- [Web Application Firewall](/docs/reference/modules/waf) for layered input inspection.
