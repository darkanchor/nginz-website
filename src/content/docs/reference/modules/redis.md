---
title: Redis
description: Non-blocking Redis client built into nginz. Supports 14 RESP commands with URI-based or static key derivation, JSON responses, and nginx variables for scripted consumers.
---

# Redis

Use this module when nginz needs to talk directly to Redis. It speaks the Redis RESP protocol over non-blocking upstream connections, so there is no need for a separate sidecar or proxy.

## When to use this module

- You want nginz to fetch cached data from Redis without a round trip through application code.
- You need counters, TTL checks, or hash-field lookups at the nginx layer.
- You are building orchestration flows where njs calls Redis and other backends in the same request.
- You want cheap per-request Redis state exposed as nginx variables for policy decisions.

## nginx.conf synthesis

```nginx
http {
    server {
        listen 8080;

        # Read a value (GET /cache/mykey -> GET "cache/mykey")
        location /cache/ {
            redis_pass 127.0.0.1:6379;
        }

        # Store a value (POST /set/mykey with body "value" -> SET "set/mykey" "value")
        location /set/ {
            redis_pass 127.0.0.1:6379;
            redis_command set;
        }

        # Increment a counter (POST /incr/counter -> INCR "incr/counter")
        location /incr/ {
            redis_pass 127.0.0.1:6379;
            redis_command incr;
        }

        # Check key existence (GET /exists/mykey -> EXISTS "exists/mykey")
        location /exists/ {
            redis_pass 127.0.0.1:6379;
            redis_command exists;
        }

        # Set TTL (POST /expire/mykey with body "3600" -> EXPIRE "expire/mykey" 3600)
        location /expire/ {
            redis_pass 127.0.0.1:6379;
            redis_command expire;
        }

        # Static key (GET /config -> GET "app-config")
        location /config {
            redis_pass 127.0.0.1:6379;
            redis_key app-config;
        }

        # Hash operations (GET /hget/myhash?field=name -> HGET "hget/myhash" name)
        location /hget/ {
            redis_pass 127.0.0.1:6379;
            redis_command hget;
        }

        # Health check (GET /ping -> PING)
        location /ping {
            redis_pass 127.0.0.1:6379;
            redis_command ping;
        }
    }
}
```

## Supported commands

| Command | HTTP method | What it does |
|---------|-------------|--------------|
| `get` (default) | GET | Fetch a value by key |
| `set` | POST | Store a value (body is the value) |
| `del` | POST, DELETE | Delete a key |
| `incr` | POST | Increment a counter |
| `decr` | POST | Decrement a counter |
| `expire` | POST | Set TTL in seconds (body optional, defaults to 60) |
| `mget` | GET | Get multiple values (`?keys=key1,key2,...`) |
| `exists` | GET | Check if key exists |
| `ttl` | GET | Get remaining TTL |
| `ping` | GET | Health check |
| `strlen` | GET | Get string length |
| `hget` | GET | Get hash field (`?field=name`) |
| `hset` | POST | Set hash field (`?field=name`, body is value) |
| `hdel` | POST, DELETE | Delete hash field (`?field=name`) |

## Key derivation

When `redis_key` is not set, the Redis key is derived from the request URI:

- `GET /cache/mykey` uses key `cache/mykey`
- `GET /data` uses key `data`

The leading slash is stripped. Use `redis_key` to pin a fixed key for a location.

## Response format

```json
// GET (found)
{"value":"the-value-from-redis"}

// GET (not found)
{"value":null}

// SET, PING
{"ok":true}

// INCR, DECR, DEL, EXISTS, TTL, STRLEN, EXPIRE, HSET, HDEL
{"value":42}

// MGET
{"values":["value1","value2",null]}

// Error
{"error":"connection_failed"}
```

## Nginx variables

These variables expose Redis state without a subrequest round-trip:

| Variable | What it gives you |
|----------|-------------------|
| `$redis_last_value` | The value from the last GET or HGET (or not found) |
| `$redis_last_exists` | `1` if the key existed, `0` if not |
| `$redis_last_error` | `redis_error` or `connection_failed` when something went wrong |
| `$redis_connection_state` | `connected`, `degraded`, or `error` |

Use these in njs handlers for cheap conditional logic: check `$redis_last_exists` before parsing JSON, or inspect `$redis_connection_state` for health-aware routing.

## Directive reference

### `redis_pass`

- **Contexts:** `location`
- **Default:** none

Sets the Redis server address (`host:port`). Enables the Redis handler for the location.

### `redis_key`

- **Contexts:** `location`
- **Default:** derived from URI

Sets a static Redis key instead of deriving it from the URI path.

### `redis_command`

- **Contexts:** `location`
- **Default:** `get`

Selects the Redis command to execute. See supported commands above.

## Limitations

- Authentication (Redis AUTH) is not supported.
- Single command per connection (no pipelining).
- MGET is limited to 16 keys per request.

## Works well with

- [NJS Orchestration](/docs/reference/modules/njs) for caching, counters, and read-through patterns that combine Redis with other backends.
- [PostgREST](/docs/reference/modules/pgrest) for caching query results and warming cache from database writes.
- [Circuit Breaker](/docs/reference/modules/circuit-breaker) when `$redis_connection_state` feeds into backend health decisions.
