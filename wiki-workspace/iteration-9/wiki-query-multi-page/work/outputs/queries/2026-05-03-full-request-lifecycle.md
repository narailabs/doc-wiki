---
title: Full request lifecycle from authentication through DB write
type: synthesis
question: what's the full request lifecycle from user authentication through DB write?
created: 2026-05-03
topic: request-lifecycle
tags:
  - architecture
  - authentication
  - request-flow
  - jwt
  - postgresql
sources:
  - wiki/auth.md
  - wiki/request-routing.md
  - wiki/app-server.md
  - wiki/db-write-path.md
  - wiki/audit-log.md
---

# Full Request Lifecycle

## Answer

A request from a user travels through five distinct layers in this system, end to end:

1. **TLS termination + ingress routing** — public traffic hits nginx ([request-routing](../../wiki/request-routing.md)), which terminates TLS and forwards by path prefix (`/auth/*`, `/api/v1/orders/*`, ...) into the cluster, adding `X-Forwarded-For` and `X-Real-IP` headers.

2. **Authentication** — the target service inspects the `Authorization: Bearer <jwt>` header. JWTs are signed with RS256; the service verifies signature, `exp`, and the `roles` claim against the route's required scope ([auth](../../wiki/auth.md)).

3. **App-server dispatch** — each microservice is a stateless Node.js process listening on port 3000. After JWT validation it dispatches to the request handler ([app-server](../../wiki/app-server.md)). Pods are stateless and scale horizontally via Kubernetes deployments; each pod opens a pg connection pool with up to 10 connections.

4. **Database write** — handlers writing data take a connection from the pg pool, open a transaction (`BEGIN`), perform DML, and `COMMIT` ([db-write-path](../../wiki/db-write-path.md)). Deadlock retries are handled in the pool layer with up to 3 attempts and exponential backoff.

5. **Audit log** — within the same transaction as the primary write, the handler INSERTs an `audit_log` row with `actor_user_id`, `action`, `entity_type`, `entity_id`, and `ts` ([audit-log](../../wiki/audit-log.md)). Audit and primary write commit (or roll back) together by transactional design.

## Citations

- [auth](../../wiki/auth.md) — JWT validation, RS256 signing, roles claim
- [request-routing](../../wiki/request-routing.md) — nginx ingress, path-prefix routing
- [app-server](../../wiki/app-server.md) — Node.js stateless processes, pg connection pool of 10
- [db-write-path](../../wiki/db-write-path.md) — BEGIN/INSERT/COMMIT, deadlock retries
- [audit-log](../../wiki/audit-log.md) — audit_log table schema, transactional commit-with-write

## Knowledge gaps

The current source pages do not document:

- **Request-id propagation**: there is no description of how a correlation/trace id is generated at the ingress and threaded through service-to-service calls and into the audit_log row. None of the five pages mention `X-Request-Id`, OpenTelemetry, or similar.
- **Error-path rollback**: the pages describe the happy-path commit, but the failure-path behavior (what happens when the audit-log INSERT fails, what happens when the primary INSERT succeeds but a downstream call fails, how the connection pool reacts to mid-transaction errors) is not documented.

These should be follow-up ingestions or a fix targeted at audit-log.md / db-write-path.md.
