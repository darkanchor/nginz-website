---
title: Worker Events
description: Cross-worker event bus for publishing and inspecting signals across all nginx workers without polling.
---

# Worker Events

Use this module when other modules or operators need to broadcast notifications across workers without polling shared state.

## When to use this module

- A module needs to tell every worker that something changed (e.g., a cache was purged, a peer was drained).
- You want to avoid busy-waiting or polling loops for cross-worker coordination.
- You need an operational endpoint to inspect recent events and debug coordination issues.
- You build infrastructure modules that need a publish/subscribe primitive inside nginx.

## nginx.conf synthesis

The worker-events module exposes a JSON API on an internal location. Modules publish events into a shared-memory ring, and any worker can inspect them.

```nginx
location /internal/worker-events {
    worker_events_api;
    worker_events_zone bus;
    worker_events_channel cache.invalidate;
    worker_events_ring_size 1024;
    worker_events_publish_key changeme;
}
```

This creates an endpoint where:

- `GET /internal/worker-events` inspects the ring state, with optional `?channel=`, `?since=`, and `?limit=` filters.
- `POST /internal/worker-events?key=changeme` publishes an event with a JSON body: `{"type": "purged", "payload": "tag:assets"}`.
- `HEAD /internal/worker-events` returns the same headers as GET without the body.
- Other HTTP methods return 405.

## Directive reference

### `worker_events_api`

- **Contexts:** `location`
- **Default:** disabled

Turns the location into the publish/inspect endpoint for worker events.

### `worker_events_zone`

- **Contexts:** `location`
- **Default:** none

Selects the shared-memory zone that holds the event ring. The zone must be large enough to hold the configured ring entries plus the control block.

### `worker_events_channel`

- **Contexts:** `location`
- **Default:** none

Sets the default logical channel for the endpoint. All events published through this endpoint are tagged with this channel name.

### `worker_events_ring_size`

- **Contexts:** `location`
- **Default:** `1024`

Configures the ring buffer capacity in entries. When the ring is full, the oldest entry is overwritten and the dropped-event counter increments.

### `worker_events_publish_key`

- **Contexts:** `location`
- **Default:** none

Requires a `?key=<secret>` query parameter on POST requests for publish authorization. GET and HEAD remain open for inspection.

## Behavior notes

- Events are stored in a fixed-size ring buffer in shared memory. Each entry holds: generation, channel (up to 64 bytes), type (up to 64 bytes), payload (up to 512 bytes), and a timestamp.
- When the ring fills up, the oldest entry is overwritten and `dropped_events` is incremented. This is an explicit design choice: the ring is a best-effort coordination primitive, not a guaranteed delivery queue.
- Published events are visible across all workers. Multi-worker visibility is verified by integration tests.
- POST requires `Content-Type: application/json`. Payload is optional in the JSON body.
- `worker_events_api` requires both `worker_events_zone` and `worker_events_channel` to be configured. Config load fails if either is missing.
- The inspect response exposes: module, zone, channel, capacity, oldest_generation, newest_generation, dropped_events, last_publish_msec, and the filtered events array.

## Current consumers

These modules publish into the worker-events ring:

- [Cache Purge API](/docs/reference/modules/cache-purge): publishes `purged` and `purge_batch` events on successful invalidation.
- [Dynamic Upstreams](/docs/reference/modules/dynamic-upstreams): publishes `snapshot_activated`, `refresh_failed`, and drain-related events.
- [Health Checks](/docs/reference/modules/healthcheck): publishes `transition` events when service-level probe health flips.

## Works well with

- [Cache Purge API](/docs/reference/modules/cache-purge) for cross-worker cache invalidation notifications.
- [Dynamic Upstreams](/docs/reference/modules/dynamic-upstreams) for snapshot activation and refresh-failure notifications.
- [Health Checks](/docs/reference/modules/healthcheck) for service-level health transition fanout.
