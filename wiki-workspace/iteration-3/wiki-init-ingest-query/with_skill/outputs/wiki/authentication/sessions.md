---
title: Server-Side Sessions
type: concept
tags: [session-management, postgresql, cookies, revocation, authentication]
sources: [raw/docs/architecture.md]
created: 2026-04-14
updated: 2026-04-14
quality: 0.0
summary: >
  Every logged-in user has a server-side session row in the PostgreSQL
  `sessions` table, keyed by a `session_id` UUID that is mirrored into an
  HttpOnly Secure SameSite=Lax cookie. The session row is the source of
  truth for liveness: setting `revoked_at` invalidates the session even
  though any still-valid JWT survives until its 15-minute `exp`.
---

# Server-Side Sessions

Although [JWTs](./jwt.md) are self-contained, every logged-in user also has a
server-side session record. This is what gives us an immediate revocation
path — the JWT alone cannot be invalidated mid-flight, but the session can.

## Storage

Sessions live in a **PostgreSQL** `sessions` table. Each row is keyed by a
`session_id` UUID. That UUID is mirrored into an HttpOnly, Secure,
SameSite=Lax cookie of the same name, set on successful login. Every request
therefore carries two correlated credentials: the JWT in the `Authorization`
header and the `session_id` cookie.

### Schema

```sql
CREATE TABLE sessions (
    session_id      UUID PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    user_agent      TEXT,
    ip_address      INET,
    revoked_at      TIMESTAMPTZ NULL
);

CREATE INDEX sessions_user_active
  ON sessions (user_id, revoked_at);
```

The composite index on `(user_id, revoked_at)` is what powers the "log out
other devices" feature: we can quickly enumerate a user's unrevoked sessions.

## Cookie Properties

| Attribute | Value | Why |
|---|---|---|
| HttpOnly | yes | Prevents JavaScript from reading the cookie. |
| Secure | yes | Never sent over plain HTTP. |
| SameSite | Lax | Blocks most CSRF without breaking top-level navigation. |
| Name | `session_id` | Matches the primary key column. |

## Revocation Semantics

Revocation is a single UPDATE:

```sql
UPDATE sessions
   SET revoked_at = now()
 WHERE session_id = $1;
```

After that point, every verifier that consults the session row (refresh
attempts, sensitive-op guards) will treat the user as logged out. The
outstanding 15-minute JWT is still cryptographically valid until `exp`, but
the [refresh endpoint](./refresh.md) will reject any attempt to extend the
session, and sensitive operations are already gated behind a session lookup.

This is a deliberate trade-off: the hot path stays stateless (signature verify
only, no DB hit), but we accept up to 15 minutes of stale access on
non-sensitive reads after logout.

## Related Pages

- [Authentication Overview](./overview.md)
- [JWT Access Tokens](./jwt.md)
- [Refresh Endpoint](./refresh.md)
- [Claim: Logout Revokes All Tokens](../claims/logout-revokes-all-tokens.md)

## How to Go Deeper

- **Database:** `wiki agent db-query dev "SELECT session_id, user_id,
  revoked_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC"`
- **Raw source:** [raw/docs/architecture.md](../../raw/docs/architecture.md)
