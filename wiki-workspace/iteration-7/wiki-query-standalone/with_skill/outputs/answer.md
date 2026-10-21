---
topic: request-lifecycle
tags: [auth, jwt, nginx, routing, app-server, postgres, audit, lifecycle]
created: 2026-04-14T00:00:00Z
query: "What is the full request lifecycle from user authentication through DB write?"
pages_read:
  - wiki/summaries.md
  - wiki/auth.md
  - wiki/request-routing.md
  - wiki/app-server.md
  - wiki/db-write-path.md
  - wiki/audit-log.md
---

# Full Request Lifecycle: Authentication Through DB Write

This answer synthesises information from all five wiki pages covering the end-to-end flow.

## 1. User Authentication

Before any request reaches application logic, the user must authenticate. The system issues **JWT** tokens signed with RS256 ([auth](../../wiki/auth.md)). The client sends `POST /auth/login`, the credential service validates the bcrypt hash, and on success:

- A JWT (15-minute TTL) is returned as a Bearer token.
- A refresh cookie (`HttpOnly; Secure; SameSite=Strict`) is set.
- A row is inserted into the `sessions` table recording the token hash, `user_id`, and expiry.

Subsequent requests carry the JWT in the `Authorization: Bearer <token>` header. The auth middleware re-validates JWT signature and expiry, and queries the `sessions` table to confirm the session has not been revoked.

## 2. Request Routing via nginx

Inbound HTTPS traffic hits **nginx** first ([request-routing](../../wiki/request-routing.md)). nginx:

- Terminates TLS.
- Applies rate limiting before proxying.
- Selects the correct upstream cluster via per-host routing based on the `Host` header (`api.example.com`, `admin.example.com`, etc.).
- Appends the real client IP to `X-Forwarded-For` using `$proxy_add_x_forwarded_for`.
- Forwards the `Authorization` header verbatim — nginx does not inspect or validate JWTs.

## 3. App-Server Processing

nginx forwards the request to one of the app-tier worker pool processes ([app-server](../../wiki/app-server.md)). The app-server runs Node.js in cluster mode (one worker per CPU core). Each request traverses a fixed middleware chain:

1. Request parsing (JSON body, query string, multipart).
2. **Auth middleware** — verifies JWT, revocation-checks against `sessions`, attaches `req.user`.
3. Rate limiter — sliding-window counter per `(user_id, endpoint)` stored in Redis.
4. Input validation — JSON Schema check on the request body.
5. Route handler — delegates to the service layer.
6. Response serializer — strips internal fields before returning.

The service layer encapsulates all business logic and is the sole caller of the database.

## 4. DB Write Path

When the service layer needs to persist data, it acquires a connection from the **pg connection pool** ([db-write-path](../../wiki/db-write-path.md)). The pool is configured with `max: 20` connections and a 30-second idle timeout. Write operations follow this pattern:

1. `pool.connect()` acquires a client.
2. `BEGIN` starts the transaction.
3. The primary business row is inserted.
4. An audit row is inserted into `audit_log` in the same transaction.
5. `COMMIT` makes both rows durable atomically.
6. The client is released back to the pool.

## 5. Audit Logging

Every write lands a row in the **audit_log table** ([audit-log](../../wiki/audit-log.md)). The schema captures `actor_id`, `action` (e.g., `order.create`), `resource_id`, `resource_type`, old/new JSON snapshots, and `ip_address` (derived from `X-Forwarded-For`). Because the audit row is written inside the same transaction as the business row, it is atomically consistent — if the business write rolls back, the audit row rolls back too. Audit rows are retained for 2 years.

## Summary of the Chain

```
Client
  → POST /auth/login → JWT issued, sessions row written
  → Bearer JWT on subsequent request
  → nginx (TLS termination, per-host routing, X-Forwarded-For, rate limit)
  → App-server worker (auth middleware → rate limit → validation → handler)
  → Service layer → pg connection pool
      BEGIN
        INSERT main business row
        INSERT audit_log row
      COMMIT
```

---

## Knowledge gaps

The source pages do not cover the following aspects of the request lifecycle:

1. **Request-ID propagation** — none of the five pages describe how a correlation or trace ID is generated at the nginx or app-server boundary, whether it is attached to the JWT claims or a separate header, or how it flows through to the `audit_log` row. It is unclear whether request IDs exist in this system at all, and if so, which component is responsible for generating and propagating them across service boundaries.

2. **Error-path rollback behavior** — the DB write path shows the `ROLLBACK` call in the catch block, but no page explains what happens upstream when a rollback occurs: whether the app-server returns a specific error schema to the client, whether the failed write is retried, or how partial failures (e.g., main row succeeds but audit row fails) are handled. The observable behavior on the client side after a failed transaction is not documented.
