---
title: "System Architecture"
page_type: reference
sources:
  - /tmp/eval-i4-ingest-folder/docs/architecture.md
tags: ["system-architecture", "service-mesh", "api-gateway", "kafka", "strangler-fig"]
content_hash: "f9e71a32f05a745db27dbcf9d8e8ca0029e63c62429110c9eca745e20ad8de42"
ingested_at: "2026-04-14T20:07:09.136Z"
---
# System Architecture

# System Architecture

The platform follows a layered architecture with clear separation between presentation, business logic, and data persistence. Each layer communicates through well-defined interfaces, enabling independent scaling and replacement of components.

## High-Level Components

- **API Gateway**: The entry point for all external traffic. It performs TLS termination, rate limiting, request validation, and authentication. Built on Envoy, it routes requests to appropriate backend services based on path and header matching rules.
- **Service Mesh**: Istio provides service-to-service authentication via mTLS, traffic shaping, circuit breaking, and observability. Every pod is injected with a sidecar proxy.
- **Application Services**: Domain services written in Go and Java, packaged as containers, and deployed to Kubernetes. Each service owns its schema and publishes domain events to Kafka.
- **Data Plane**: PostgreSQL 15 clusters for transactional data, Redis for caching and session state, ClickHouse for analytics, and S3-compatible object storage for assets.

## Request Flow

A typical read request enters the API Gateway, is validated, then routed through the service mesh to the relevant application service. The service consults Redis first; on cache miss it queries PostgreSQL and backfills the cache with a 5-minute TTL.

Write requests follow the same path but are synchronously persisted to PostgreSQL, then a change event is emitted to Kafka. Downstream consumers (search indexer, audit logger, email dispatcher) pick up events asynchronously, providing eventual consistency across read models.

## Deployment Topology

Services are deployed across three availability zones in each region, with active-active configuration. Regional failover uses DNS-based geo-routing at the edge CDN. Database primaries are confined to one zone with synchronous replicas in the other two for durability.

## Evolution

The original monolith was decomposed starting in 2023. The migration used the strangler-fig pattern with a facade routing specific endpoints to the new services as they came online, preserving the legacy system until final cutover in late 2024.


## Related Pages

(populated by crosslink hook)
