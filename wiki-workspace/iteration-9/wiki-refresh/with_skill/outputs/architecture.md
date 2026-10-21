---
title: Architecture
type: concept
created: 2026-04-01
updated: 2026-05-03
sources:
  - raw/architecture.md
summary: Microservices platform on Kubernetes; PostgreSQL primary store; nginx ingress fronts auth, catalog, and order services. SQLite has been retired.
tags:
  - architecture
  - microservices
  - kubernetes
  - postgresql
  - nginx
  - api-gateway
quality: 0.6
reviewer: alice
content_hash: 9b82968578151061b031f8478081219fde07dc26381c39410d8ebcd6b23ff30e
---

# Architecture

The system has been refactored into a microservices platform. It now runs on Kubernetes, uses PostgreSQL for primary storage, and exposes a public HTTPS API behind an nginx ingress.

## Components

- **api-gateway**: nginx ingress terminates TLS and routes to internal services
- **auth-service**: issues and validates JWTs; talks to PostgreSQL users/sessions tables
- **catalog-service**: serves product data; reads from PostgreSQL
- **order-service**: handles order creation and writes to PostgreSQL

## Storage

PostgreSQL 15 with read replicas. SQLite has been retired.
