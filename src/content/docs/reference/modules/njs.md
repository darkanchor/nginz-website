---
title: NJS (JavaScript) Orchestration
description: Use JavaScript handlers to orchestrate subrequests across Redis, PostgREST, and other nginx modules. Built on the QuickJS engine.
---

# NJS (JavaScript) Orchestration

Use this module when you need to coordinate multiple backend services in a single request. NJS lets you write JavaScript handlers that call internal nginx locations via subrequests, fan out to multiple services in parallel, and combine results before responding to the client.

NJS is compiled into nginz by default.

## When to use this module

- You need to combine data from Redis and PostgreSQL before responding to a client.
- You want to check a cache before falling back to a database, all inside nginx.
- You need to run a sequence of operations (write to Redis, then query PostgreSQL, then update a counter) without exposing intermediate steps to the client.
- You prefer writing orchestration logic in JavaScript rather than stitching services together in application code.

## nginx.conf synthesis

```nginx
http {
    js_engine qjs;
    js_path "/etc/nginx/njs";
    js_import main from handlers.js;

    server {
        listen 8080;

        # Internal targets (only reachable via subrequest)
        location /_redis/get/ {
            internal;
            redis_pass 127.0.0.1:6379;
        }

        location /_pgrest/api/ {
            internal;
            pgrest_pass "host=127.0.0.1 dbname=mydb user=postgres password=secret";
            pgrest_schemas "public";
        }

        # Public endpoint
        location /api/user-with-orders {
            js_content main.user_with_orders;
        }
    }
}
```

JavaScript handler:

```js
async function user_with_orders(r) {
    var [userReply, ordersReply] = await Promise.all([
        r.subrequest('/_pgrest/api/users?id=eq.1'),
        r.subrequest('/_pgrest/api/orders?user_id=eq.1'),
    ]);
    var user = JSON.parse(userReply.responseText);
    var orders = JSON.parse(ordersReply.responseText);
    r.return(200, JSON.stringify({ user: user[0], orders: orders }));
}
```

## Orchestration patterns

NJS handlers use `r.subrequest()` to call internal nginx locations. These subrequests run inside the same nginx worker with no extra network hops.

### Same-service sequences

Chain multiple operations on the same backend:

```nginx
# Redis SET then GET -- write then read back
location /combo/redis-write-read {
    js_content main.redis_write_then_read;
}
```

```js
async function redis_write_then_read(r) {
    var setReply = await r.subrequest('/_redis/combo_set', {
        method: 'POST', body: r.requestText,
    });
    var getReply = await r.subrequest('/_redis/combo_get');
    r.return(200, JSON.stringify({ set: JSON.parse(setReply.responseText), get: JSON.parse(getReply.responseText) }));
}
```

### Cross-service parallel fetch

Fan out to multiple backends simultaneously:

```js
async function redis_and_pgrest(r) {
    var [redisReply, pgReply] = await Promise.all([
        r.subrequest('/_redis/get/cached-users'),
        r.subrequest('/_pgrest/api/users'),
    ]);
    // Combine results
}
```

### Conditional cache (Redis first, PGrest on miss)

```js
async function redis_check_then_pgrest(r) {
    var cached = await r.subrequest('/_redis/get/users');
    var data = JSON.parse(cached.responseText);
    if (data.value !== null) {
        r.return(200, cached.responseText);
    } else {
        var fresh = await r.subrequest('/_pgrest/api/users');
        r.return(200, fresh.responseText);
    }
}
```

### Read-through cache (miss triggers populate)

```js
async function read_through(r) {
    var cached = await r.subrequest('/_redis/get/users');
    var data = JSON.parse(cached.responseText);
    if (data.value !== null) {
        r.return(200, cached.responseText);
    } else {
        var fresh = await r.subrequest('/_pgrest/api/users');
        await r.subrequest('/_redis/combo_set', {
            method: 'POST', body: fresh.responseText,
        });
        r.return(200, fresh.responseText);
    }
}
```

## Cross-command key sharing

When the same Redis key is used across multiple command locations, set `redis_key` explicitly so the key does not depend on the URI path:

```nginx
location /_redis/combo_set {
    internal;
    redis_pass 127.0.0.1:6379;
    redis_command set;
    redis_key combo-data;
}

location /_redis/combo_get {
    internal;
    redis_pass 127.0.0.1:6379;
    redis_command get;
    redis_key combo-data;
}
```

Now both `r.subrequest('/_redis/combo_set', ...)` and `r.subrequest('/_redis/combo_get')` operate on the same key.

## Directive reference

### `js_engine`

- **Contexts:** `http`
- **Default:** `qjs`

Selects the JavaScript engine. nginz uses QuickJS (`qjs`).

### `js_path`

- **Contexts:** `http`
- **Default:** none

Directory where njs looks for imported JavaScript modules.

### `js_import`

- **Contexts:** `http`
- **Default:** none

Imports a JavaScript file and binds it to a module name. For example, `js_import main from handlers.js` makes exported functions available as `main.functionName`.

### `js_content`

- **Contexts:** `location`
- **Default:** none

Sets a JavaScript function as the content handler for a location. The function receives the request object `r` and handles the response.

### `js_shared_dict`

- **Contexts:** `http`
- **Default:** none

Creates or references a shared in-memory key-value dictionary accessible from all nginx workers. Useful for cross-worker counters, rate-limit state, or caching.

## Available JavaScript APIs

| API | What it does |
|-----|--------------|
| `r.subrequest(uri, options?)` | Sends an internal subrequest to another nginx location |
| `Promise.all()` | Run multiple subrequests in parallel |
| `r.args` | Query string parameters |
| `r.requestText` | Raw request body |
| `r.headersIn` / `r.headersOut` | Request and response headers |
| `ngx.fetch(url)` | External HTTP request |
| `js_shared_dict` | Shared in-memory key-value store |
| `Buffer` | Binary encoding and decoding |
| `crypto` | Cryptographic hashing and signing |
| `querystring`, `fs`, `xml` | Standard library modules |

## Limitations

- Two back-to-back PGrest subrequests in the same handler may fail (cross-service sequences like PGrest to Redis work fine).
- URI-based key derivation means different Redis command locations produce different keys. Use `redis_key` for shared-key combos.
- Large subrequest bodies may need `client_body_in_single_buffer on` on the target location.

## Works well with

- [Redis](/docs/reference/modules/redis) for caching, counters, and session state accessed via subrequest.
- [PostgREST](/docs/reference/modules/pgrest) for database queries orchestrated through subrequests.
- [JWT Authentication](/docs/reference/modules/jwt) when handlers need to inspect or forward claims.
- [Prometheus Metrics](/docs/reference/modules/prometheus) for tracking handler invocation rates.
