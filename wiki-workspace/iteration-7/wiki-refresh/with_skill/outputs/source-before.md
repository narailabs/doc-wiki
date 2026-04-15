# System Architecture

## Overview

This document describes the original architecture of the platform. The system
is built around a microservices model where each service owns its data and
communicates via asynchronous message passing over a central event bus.

## Core Components

### API Gateway

The API gateway acts as the single entry point for all client requests. It
handles authentication, rate limiting, and request routing. All incoming HTTP
traffic is validated at this layer before being forwarded to downstream
services.

### Service Mesh

Internal service-to-service communication is managed through a service mesh
layer that provides mutual TLS, circuit breaking, and distributed tracing.
Each service registers itself with the mesh on startup and deregisters on
graceful shutdown.

### Data Layer

The data layer consists of three primary stores:

1. **Relational store** (PostgreSQL) — used for transactional workloads and
   financial records requiring ACID guarantees.
2. **Document store** (MongoDB) — used for user-generated content and
   flexible-schema data.
3. **Cache tier** (Redis) — used for session data, rate-limit counters, and
   hot-path query results.

### Message Bus

An Apache Kafka cluster provides the backbone for all asynchronous event
delivery. Producers publish domain events; consumers fan out to multiple
downstream subscribers. Retention is set to 7 days by default.

## Deployment Model

The platform runs on Kubernetes. Each service is packaged as a Docker container
and managed by Helm charts. Horizontal pod autoscaling is configured for
services with variable load profiles. Production uses a blue-green deployment
strategy to achieve zero-downtime releases.

## Observability

Metrics are exported via Prometheus and visualized in Grafana dashboards.
Structured logs are forwarded to an Elasticsearch cluster and queried through
Kibana. Distributed traces are captured using OpenTelemetry and stored in
Jaeger.

## Security Posture

All inter-service communication is encrypted at the transport layer. Secrets
are managed via HashiCorp Vault and rotated automatically. Network policies
enforce least-privilege communication between namespaces.
