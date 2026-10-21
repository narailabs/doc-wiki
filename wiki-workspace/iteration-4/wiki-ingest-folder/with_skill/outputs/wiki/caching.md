---
title: "Caching Strategy"
page_type: reference
sources:
  - /tmp/eval-i4-ingest-folder/docs/caching.md
tags: ["redis-cache", "cdn", "cache-aside", "thundering-herd", "invalidation"]
content_hash: "1001c2c5b81a555e82bfe0c43ee38542b04c70e41bc52f2ca99e3b0433312c4c"
ingested_at: "2026-04-14T20:07:09.139Z"
---
# Caching Strategy

# Caching Strategy

Caching reduces latency and protects downstream systems from predictable read load. The platform uses three cache layers: CDN at the edge, Redis in the service tier, and in-process caches for high-read hot paths.

## Edge CDN

Static assets and cacheable API responses are served through a global CDN. Cache keys include the request path, query string, and a small allow-list of headers (Accept-Language, Accept-Encoding). TTLs are configured per route; the default is 5 minutes for HTML fragments and 1 hour for images.

Cache invalidation uses surrogate-key purging. Each response carries a set of tags; an invalidation event from the origin publishes a purge request that removes all objects matching any of the supplied tags.

## Redis Caches

Every service fronts its PostgreSQL access with a Redis cluster. The standard pattern is cache-aside: read the cache, on miss fetch from PostgreSQL, then populate the cache with a TTL typically between 60 seconds and 10 minutes. Writes invalidate by deleting the affected key; read-after-write consistency is achieved by routing the subsequent read to the primary for a brief window.

Redis is deployed as a six-node cluster with three primary shards and three replicas. Failures are handled by Sentinel. Persistence uses AOF with `appendfsync everysec` — a small trade-off of durability for throughput.

## Thundering-Herd Protection

To prevent stampedes on popular keys, we use single-flight locking: on cache miss, the first caller takes a short-lived distributed lock and populates the cache while others wait. The lock TTL is 500 ms, beyond which any caller may retry.

## Cache Coherence

Invalidation correctness relies on a "key prefix" convention: every cached entry's key encodes the owning entity's ID. When an entity is updated, the service emits a coherence event consumed by all regional cache layers, ensuring stale entries are purged across the fleet within a second.

## Observability

Cache hit ratios are exported per-cache and per-endpoint. Alerts fire when hit ratio drops below 70% for a sustained period, which typically indicates a rollout error or upstream change.


## Related Pages

(populated by crosslink hook)
