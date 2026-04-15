---
title: System Architecture
type: concept
tags:
  - architecture
  - microservices
  - kubernetes
  - unified-gateway-ingress
  - control-plane
  - observability
  - zero-trust
  - ebpf
reviewer: alice
sources:
  - raw/architecture.md
created: "2026-04-10T08:00:00+00:00"
updated: "2026-04-15T00:56:30+00:00"
summary: Redesigned platform architecture centered on the unified gateway ingress control plane, upgraded service mesh with eBPF telemetry, consolidated data layer, Confluent Cloud Kafka migration, and unified OpenTelemetry observability stack with zero-trust networking.
---

# System Architecture (v2)

## Overview

Following the Q1 infrastructure review, the platform has been redesigned around
a **unified gateway ingress** pattern. The previous multi-tier gateway approach
has been replaced with a single programmable control plane, reducing latency
and simplifying traffic management.

## Core Components

### Unified Gateway Ingress

The unified gateway ingress is the cornerstone of the new architecture. All
inbound traffic — HTTP, WebSocket, and gRPC — flows through this single control
point. The unified gateway ingress handles protocol negotiation, load balancing,
canary routing, and request transformation in a single pass, eliminating the
overhead of the previous layered approach.

### Control Plane

A dedicated control plane service manages gateway configuration, certificate
lifecycle, and traffic policies. Changes are applied atomically through a
declarative YAML API, enabling GitOps-style management of routing rules.

### Service Mesh

Internal service-to-service communication continues through a service mesh
layer providing mutual TLS, circuit breaking, and distributed tracing. The
mesh has been upgraded to support eBPF-based telemetry collection, reducing
sidecar overhead by approximately 40%.

### Data Layer

The data layer has been consolidated:

- **Primary store** (PostgreSQL with Citus) — horizontally sharded for
  write-heavy workloads requiring ACID guarantees.
- **Document store** (MongoDB Atlas) — migrated to managed cloud instance
  with automated backups and point-in-time recovery.
- **Cache tier** (Redis Cluster) — upgraded to cluster mode for high
  availability; used for session data and hot-path results.

### Event Streaming

Apache Kafka remains the backbone for asynchronous event delivery, now hosted
on Confluent Cloud. Topic retention increased to 14 days. A new schema registry
enforces contract compatibility between producers and consumers.

## Deployment Model

The platform runs on Kubernetes 1.29 with Helm chart versions pinned across
environments. A new Argo CD integration provides progressive delivery with
automatic rollback on error-rate spikes. The blue-green deployment strategy
remains in place.

## Observability

The full observability stack has been unified under OpenTelemetry. Metrics,
logs, and traces all flow through the OTel collector before fan-out to
Prometheus, Loki, and Tempo respectively. Grafana serves as the single pane
of glass for all signal types.

## Security Posture

Zero-trust networking has been implemented across all namespaces. Workload
Identity federation replaces long-lived service account keys. HashiCorp Vault
manages application secrets with dynamic credential generation. All ingress
traffic is terminated at the unified gateway ingress layer and re-encrypted
for internal routing.
