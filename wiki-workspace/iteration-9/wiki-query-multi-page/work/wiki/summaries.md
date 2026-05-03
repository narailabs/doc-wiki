---
title: Page Summaries
type: index
tags: [wiki-meta, progressive-disclosure]
sources:
  - wiki/
created: "2026-05-03"
updated: "2026-05-03"
quality: 0.0
summary: >
  Approximately 50-token summary per wiki page. Used by /doc-wiki:query for progressive-disclosure search. Auto-managed by summaries_rebuild.ts.
audience: contributor
---

# Summaries

High-level summaries of wiki topics.

<!-- wiki-managed: summaries start -->

## Pages

- [App Server](app-server.md) — Each microservice runs as a stateless Node.js process listening on port 3000; horizontal scaling via Kubernetes deployments. _(tags: app-server, nodejs, stateless, microservice)_
- [Audit Log](audit-log.md) — Every successful write is mirrored to the audit_log table with actor, action, and entity-id; the audit row is written within the same transaction as the primary write. _(tags: audit-log, compliance, postgresql, audit-trail)_
- [Authentication](auth.md) — Service authenticates clients with JWTs verified at the auth-service layer; tokens carry user_id and expire after 15 minutes. _(tags: authentication, jwt, access-token, rs256)_
- [Database Write Path](db-write-path.md) — Writes go to PostgreSQL primary via the pg connection pool; transactions wrap multi-row updates; deadlock retries are handled at the pool layer. _(tags: database, postgresql, write-path, connection-pool)_
- [Wiki Overview](overview.md) — Global architecture narrative. Initially empty; populated by /doc-wiki:atlas Phase 7 from per-topic atlas pages. _(tags: wiki-meta, architecture)_
- [Request Routing](request-routing.md) — Public traffic enters via nginx, which terminates TLS and routes by path prefix to internal services running in Kubernetes. _(tags: routing, nginx, kubernetes, load-balancer)_

<!-- wiki-managed: summaries end -->
