---
title: PostgREST-compatible PostgreSQL API
description: Turn PostgreSQL into a RESTful API directly from nginz. Supports CRUD, stored procedures, filtering, pagination, schema selection, and JWT-based access control.
---

# PostgREST-compatible PostgreSQL API

Use this module when you want to expose a PostgreSQL database through a RESTful HTTP API without running a separate application server. Pgrest maps HTTP methods to SQL operations, supports the PostgREST URL query grammar, and handles connection pooling, content negotiation, and JWT authentication inside nginz.

## When to use this module

- You want a direct REST API on top of PostgreSQL without writing boilerplate CRUD code.
- You need to expose stored procedures as HTTP endpoints.
- You want PostgREST-compatible filtering, pagination, and schema selection at the nginx layer.
- You need to enforce row-level security using JWT claims passed through to PostgreSQL.

## nginx.conf synthesis

```nginx
http {
    server {
        listen 8080;

        # Table API
        location /api/ {
            pgrest_pass "host=localhost dbname=mydb user=postgres password=secret";
            pgrest_schemas "public, tenant";
            # Optional: 15s is the built-in default.
            pgrest_timeout 15s;
        }

        # Stored procedure API
        location /rpc/ {
            pgrest_pass "host=localhost dbname=mydb user=postgres password=secret";
        }
    }
}
```

## Pool and timeout sizing

Pgrest defaults to a 16-connection pool and a 15-second connect/query socket
timeout. The timeout is intentionally long enough for monitoring dashboards
whose analytical reads share PostgreSQL with sustained telemetry ingestion. It
was validated with a 200 request/second gateway workload and concurrent
dashboard reads; it is a timeout budget, not a query-performance guarantee.

Do not increase the pool merely because a query is slow. More simultaneous
aggregate scans can increase disk spills and delay writers. First inspect the
query plan, remove duplicate scans, add appropriate rollups or indexes, and let
the dashboard cache data for its normal refresh interval. Override the timeout
only when the workload needs a different latency contract:

```nginx
location /api/ {
    pgrest_pass "host=localhost dbname=monitoring user=dashboard_reader";
    pgrest_pool_size 16;
    pgrest_timeout 15s;
}
```

## CRUD operations

Pgrest maps HTTP methods to SQL on table endpoints (`/api/table_name`).

### Read (GET)

```bash
# Get all rows
curl "http://localhost/api/users"

# Select specific columns
curl "http://localhost/api/users?select=id,name,email"

# Filter rows
curl "http://localhost/api/users?status=eq.active&age=gt.18"

# Order and paginate
curl "http://localhost/api/users?order=created_at.desc&limit=10&offset=20"
```

### Create (POST)

```bash
curl -X POST "http://localhost/api/users" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com", "status": "active"}'
```

### Update (PATCH)

```bash
curl -X PATCH "http://localhost/api/users?id=eq.5" \
  -H "Content-Type: application/json" \
  -d '{"status": "inactive"}'
```

### Delete (DELETE)

```bash
curl -X DELETE "http://localhost/api/users?id=eq.5"
```

## Stored procedures (RPC)

Call PostgreSQL functions via `/rpc/function_name`.

```bash
# Simple function (GET)
curl "http://localhost/rpc/get_user_count"

# Function with parameters (GET)
curl "http://localhost/rpc/get_users_by_status?status=active"

# Function with JSON body (POST) -- preserves data types
curl -X POST "http://localhost/rpc/add_them" \
  -H "Content-Type: application/json" \
  -d '{"a": 1, "b": 2}'
```

JSON arrays in RPC parameters are automatically converted to PostgreSQL `ARRAY[...]` syntax:

```bash
curl -X POST "http://localhost/rpc/process_numbers" \
  -H "Content-Type: application/json" \
  -d '{"ids": [1, 2, 3, 4, 5]}'
```

## Filter operators

| Operator | SQL | Example |
|----------|-----|---------|
| `eq` | `=` | `?id=eq.5` |
| `neq` | `<>` | `?status=neq.deleted` |
| `gt` | `>` | `?age=gt.18` |
| `gte` | `>=` | `?age=gte.21` |
| `lt` | `<` | `?price=lt.100` |
| `lte` | `<=` | `?price=lte.50` |
| `like` | `LIKE` | `?name=like.John%` |
| `ilike` | `ILIKE` | `?name=ilike.john%` |
| `match` | `~` | `?name=match.^J.*n$` |
| `is` | `IS` | `?deleted_at=is.null` |
| `in` | `IN` | `?status=in.(active,pending)` |
| `fts` | `@@` | `?tsv=fts.english.query` |

Logical operators: `or=(...)`, `and=(...)`, `not.<op>`.

## Schema selection

Choose a PostgreSQL schema using HTTP headers:

```bash
# Default schema (first entry in pgrest_schemas)
curl "http://localhost/api/users"

# Specific schema for reads
curl "http://localhost/api/users" -H "Accept-Profile: tenant"

# Specific schema for writes
curl -X POST "http://localhost/api/users" \
  -H "Content-Profile: tenant" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}'
```

Configure the allowed schemas:

```nginx
location /api/ {
    pgrest_pass "host=localhost dbname=mydb user=postgres password=secret";
    pgrest_schemas "public, tenant, admin";
}
```

The first schema in the list is the default. Requests for schemas outside the list are rejected.

## JWT authentication

Pgrest validates JWT tokens and passes them to PostgreSQL for role switching and row-level security.

```nginx
location /api/ {
    pgrest_pass "host=localhost dbname=mydb user=authenticator password=secret";
    pgrest_jwt_secret "your-256-bit-secret";
    pgrest_anon_role "anon";
    pgrest_jwt_role_claim "role";
}
```

When a valid JWT with a `role` claim is provided, pgrest runs `SET ROLE '<role>'` on the database connection. Invalid or missing tokens use the anonymous role. The raw JWT is also available inside PostgreSQL via `current_setting('request.jwt')`.

## Content negotiation

Responses default to JSON. Request other formats with the `Accept` header:

```bash
# CSV
curl "http://localhost/api/users" -H "Accept: text/csv"

# XML
curl "http://localhost/api/users" -H "Accept: text/xml"

# Single object (instead of array)
curl "http://localhost/api/users?id=eq.1" \
  -H "Accept: application/vnd.pgrst.object+json"

# Stripped nulls
curl "http://localhost/api/users" \
  -H "Accept: application/vnd.pgrst.array+json;nulls=stripped"
```

## Response formats

Successful queries return a JSON array:

```json
[
  {"id": 1, "name": "Alice", "email": "alice@example.com"},
  {"id": 2, "name": "Bob", "email": "bob@example.com"}
]
```

Error responses use a consistent shape:

```json
{"message": "Undefined table"}
```

## Pagination and count

```bash
# Limit and offset
curl "http://localhost/api/users?limit=10&offset=20"

# Range headers
curl "http://localhost/api/users" -H "Range-Unit: items" -H "Range: 10-19"

# Include total count
curl "http://localhost/api/users?limit=10" -H "Prefer: count=exact"
```

## Ordering

```bash
curl "http://localhost/api/users?order=name.asc"
curl "http://localhost/api/users?order=created_at.desc.nullslast"
curl "http://localhost/api/users?order=name,id.desc"
```

## Bulk operations

```bash
# Bulk JSON insert
curl -X POST "http://localhost/api/users" \
  -H "Content-Type: application/json" \
  -d '[
    {"name":"Alice","email":"alice@example.com"},
    {"name":"Bob","email":"bob@example.com"}
  ]'

# Upsert on conflict
curl -X POST "http://localhost/api/employees?on_conflict=name" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates, return=representation" \
  -d '[{"name":"Alice","salary":50000}]'
```

## Directive reference

| Directive | Context | Default | Description |
|-----------|---------|---------|-------------|
| `pgrest_pass` | `location` | -- | PostgreSQL connection string. All locations in a worker share one connection pool. |
| `pgrest_pool_size` | `location` | `16` | Maximum pooled connections (1-16). |
| `pgrest_timeout` | `location` | `15s` | Connect/query socket timeout. Inherited by nested locations. |
| `pgrest_schemas` | `location` | -- | Comma-separated schema allowlist. First entry is the default. |
| `pgrest_jwt_secret` | `location` | -- | HS256 secret for JWT signature validation. |
| `pgrest_anon_role` | `location` | -- | PostgreSQL role for unauthenticated requests. |
| `pgrest_jwt_role_claim` | `location` | `role` | JWT claim containing the PostgreSQL role. |

## Limitations

- CRUD operates on single tables only. Use RPC for joins and complex queries.
- The `application/octet-stream` response format works only for single-row, single-column results.
- Non-JSON response formats are not available for embedded resource reads.

## Works well with

- Stock nginx `proxy_cache` — cache pgrest responses at the nginx level for read-heavy workloads.
- [NJS Orchestration](/docs/reference/modules/njs) for orchestrating subrequests across pgrest and Redis.
- [Redis](/docs/reference/modules/redis) for caching pgrest responses or offloading hot data.
- [JWT Authentication](/docs/reference/modules/jwt) for token validation before requests reach pgrest.
- [Prometheus Metrics](/docs/reference/modules/prometheus) for monitoring query volume and error rates.
