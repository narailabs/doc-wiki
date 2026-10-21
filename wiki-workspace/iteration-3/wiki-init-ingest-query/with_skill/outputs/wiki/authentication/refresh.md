---
title: Refresh Endpoint and Token Lifecycle
type: concept
tags: [refresh-tokens, token-rotation, authentication, postgresql, session-management]
sources: [raw/docs/architecture.md]
created: 2026-04-14
updated: 2026-04-14
quality: 0.0
summary: >
  Clients exchange expiring JWTs for fresh ones by posting to
  `POST /auth/refresh`. The endpoint is backed by a PostgreSQL
  `refresh_tokens` table and rotates the refresh token on every call; the
  old row's `rotated_to` field records the hash of the replacement so replay
  attempts can be detected. Logout deletes every refresh token bound to the
  session and sets `revoked_at` on the session row.
---

# Refresh Endpoint and Token Lifecycle

The short 15-minute lifetime of [JWT access tokens](./jwt.md) means clients
refresh frequently. The refresh path is deliberately the only way to extend a
session — clients do not re-post credentials to the login endpoint between
logins.

## Endpoint: `POST /auth/refresh`

The endpoint reads two pieces of client state:

1. The `session_id` cookie (set on login, HttpOnly).
2. A long-lived `refresh_token`, also set as a cookie on login.

It then:

1. Looks up the `sessions` row by `session_id`; rejects if missing or if
   `revoked_at` is non-null.
2. Looks up the `refresh_tokens` row by the hash of the supplied refresh
   token; rejects if missing, expired, or already rotated.
3. Mints a new 15-minute JWT bound to the same `session_id`.
4. Rotates the refresh token: the old row's `rotated_to` field is set to the
   hash of the new token and a new `refresh_tokens` row is inserted.
5. Returns the new JWT and new refresh token to the client.

## `refresh_tokens` Schema

```sql
CREATE TABLE refresh_tokens (
    token_hash   BYTEA PRIMARY KEY,
    session_id   UUID NOT NULL REFERENCES sessions(session_id),
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    rotated_to   BYTEA NULL
);
```

Only the *hash* of the token is stored, so an attacker who dumps the table
cannot use the tokens themselves. The `rotated_to` field is what makes
replay detection work: if a token that has already been rotated is ever
presented again, the server knows that either the legitimate client or the
attacker has the stale copy — and the safe response is to revoke the
entire session.

## Logout

`POST /auth/logout` is the counterpart:

1. Set `revoked_at = now()` on the `sessions` row.
2. Delete every `refresh_tokens` row where `session_id` matches.

Both writes happen in a single transaction, so after logout no token thread
attached to that session can be extended. Any still-valid JWT still survives
until its `exp` (at most 15 minutes) but cannot be refreshed and is rejected
by any sensitive-operation guard that re-checks the session.

## Rotation and Replay Detection

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant Auth as Auth Service
    participant DB as PostgreSQL

    C->>Auth: POST /auth/refresh (rt_old)
    Auth->>DB: SELECT * FROM refresh_tokens WHERE token_hash = sha(rt_old)
    DB-->>Auth: row (rotated_to IS NULL)
    Auth->>DB: UPDATE refresh_tokens SET rotated_to = sha(rt_new) WHERE token_hash = sha(rt_old)
    Auth->>DB: INSERT refresh_tokens (sha(rt_new), session_id, now(), +30d, NULL)
    Auth-->>C: jwt_new, rt_new
    Note over C,Auth: Attacker later replays rt_old...
    C->>Auth: POST /auth/refresh (rt_old)
    Auth->>DB: SELECT * FROM refresh_tokens WHERE token_hash = sha(rt_old)
    DB-->>Auth: row (rotated_to IS NOT NULL) — REPLAY
    Auth->>DB: UPDATE sessions SET revoked_at = now() WHERE session_id = ?
    Auth-->>C: 401 Unauthorized
```

## Related Pages

- [Authentication Overview](./overview.md)
- [JWT Access Tokens](./jwt.md)
- [Server-Side Sessions](./sessions.md)
- [Claim: Logout Revokes All Tokens](../claims/logout-revokes-all-tokens.md)

## How to Go Deeper

- **Database:** `wiki agent db-query dev "SELECT token_hash, session_id,
  rotated_to FROM refresh_tokens WHERE session_id = $1"`
- **Raw source:** [raw/docs/architecture.md](../../raw/docs/architecture.md)
