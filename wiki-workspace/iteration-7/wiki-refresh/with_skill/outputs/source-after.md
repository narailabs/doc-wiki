# System Architecture (v2)

## Overview

This document describes the updated architecture of the platform following the
Q1 infrastructure review. The system has been redesigned around a unified
gateway ingress pattern, replacing the previous multi-tier gateway approach
with a single programmable control plane.

## Core Components

### Unified Gateway Ingress

The unified gateway ingress is the cornerstone of the new architecture. All
inbound traffic — HTTP, WebSocket, and gRPC — flows through this single control
point. The unified gateway ingress handles protocol negotiation, load balancing,
canary routing, and request transformation in a single pass, eliminating the
latency overhead of the previous layered approach.

### Control Plane

A dedicated control plane service manages gateway configuration, certificate
lifecycle, and traffic policies. Changes are applied atomically through a
declarative YAML API, enabling GitOps-style management of routing rules.

### Service Mesh

Internal service-to-service communication continues to be managed through a
service mesh layer providing mutual TLS, circuit breaking, and distributed
tracing. The mesh has been upgraded to support eBPF-based telemetry collection,
reducing sidecar overhead by approximately 40%.

### Data Layer

The data layer has been consolidated:

1. **Primary store** (PostgreSQL with Citus extension) — horizontally sharded
   for write-heavy workloads and financial records requiring ACID guarantees.
2. **Document store** (MongoDB Atlas) — migrated to managed cloud instance
   with automated backups and point-in-time recovery.
3. **Cache tier** (Redis Cluster) — upgraded to cluster mode for high
   availability; used for session data and hot-path query results.

### Event Streaming

Apache Kafka remains the backbone for asynchronous event delivery. The cluster
has been migrated to Confluent Cloud for managed operations. Topic retention
has been increased to 14 days. A new schema registry enforces contract
compatibility between producers and consumers.

## Deployment Model

The platform runs on Kubernetes 1.29. Helm chart versions have been pinned
across environments. The blue-green deployment strategy remains in place.
A new Argo CD integration provides progressive delivery with automatic
rollback on error-rate spikes.

## Observability

The full observability stack has been unified under OpenTelemetry. Metrics,
logs, and traces all flow through the OTel collector before fan-out to
Prometheus, Loki, and Tempo respectively. Grafana serves as the single pane
of glass for all signal types.

## Security Posture

Zero-trust networking has been implemented across all namespaces. Workload
Identity federation replaces long-lived service account keys. HashiCorp Vault
continues to manage application secrets with dynamic credential generation.
All ingress traffic is terminated at the unified gateway ingress layer and
re-encrypted for internal routing.
