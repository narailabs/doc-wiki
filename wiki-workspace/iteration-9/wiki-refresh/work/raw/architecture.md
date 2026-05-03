# Architecture (updated)

The system has been refactored into a microservices platform. It now runs on Kubernetes, uses PostgreSQL for primary storage, and exposes a public HTTPS API behind an nginx ingress.

## Components

- **api-gateway**: nginx ingress terminates TLS and routes to internal services
- **auth-service**: issues and validates JWTs; talks to PostgreSQL users/sessions tables
- **catalog-service**: serves product data; reads from PostgreSQL
- **order-service**: handles order creation and writes to PostgreSQL

## Storage

PostgreSQL 15 with read replicas. SQLite has been retired.
