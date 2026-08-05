---
query: "how does authentication work?"
asked_at: 2026-04-14T18:28:08Z
wiki_domain: backend-services
pages_consulted:
  - wiki/authentication/overview.md
  - wiki/authentication/jwt.md
  - wiki/authentication/sessions.md
  - wiki/authentication/refresh.md
  - wiki/claims/logout-revokes-all-tokens.md
reduction_ratio: 0.62
---

# Query: how does authentication work?

## Answer

Our backend services authenticate users with a two-layer design: short-lived,
stateless **JWT access tokens** on the hot path, backed by a stateful
**server-side session** record in PostgreSQL that acts as the source of truth
for liveness and revocation. A dedicated refresh endpoint keeps sessions alive
without re-prompting the user.

### 1. Access tokens: JWT signed with RS256

Every authenticated API call carries a JSON Web Token in the
`Authorization: Bearer <token>` header. The tokens are signed with **RS256**
— an asymmetric scheme where the auth service holds the private RSA key (2048
bits) and every downstream microservice holds only the public key and verifies
signatures locally. Access tokens live **15 minutes**, and the payload carries
`sub`, `iat`, `exp`, `iss`, and a custom `sid` claim that points to a row in
the server-side `sessions` table. Details:
[JWT Access Tokens (RS256)](../../wiki/authentication/jwt.md).

### 2. Server-side sessions in PostgreSQL

Although JWTs are self-contained, every logged-in user also has a row in the
PostgreSQL **`sessions` table** keyed by a `session_id` UUID. The same UUID is
mirrored into an HttpOnly, Secure, SameSite=Lax cookie; every request
therefore carries two correlated credentials — the JWT in the header and the
`session_id` cookie. The `sessions` schema includes `user_id`, `created_at`,
`last_seen_at`, `expires_at`, `user_agent`, `ip_address`, and a nullable
`revoked_at`. A composite index on `(user_id, revoked_at)` powers the "log
out other devices" feature. See [Server-Side Sessions](../../wiki/authentication/sessions.md).

### 3. Refresh endpoint: `POST /auth/refresh`

When a JWT is about to expire, the client calls **`POST /auth/refresh`**
(never the login endpoint) with its `session_id` cookie and a long-lived
refresh token. The endpoint is backed by a separate PostgreSQL table
`refresh_tokens` with columns `token_hash` (primary key, BYTEA),
`session_id` (foreign key to `sessions`), `issued_at`, `expires_at`, and
`rotated_to`. The handler looks up both the session and the refresh-token
hash, rejects if the session is revoked or the token has already been
rotated, mints a fresh 15-minute JWT bound to the same `session_id`, and
rotates the refresh token by setting `rotated_to` on the old row and
inserting a new one. Full mechanics (including replay detection) in
[Refresh Endpoint and Token Lifecycle](../../wiki/authentication/refresh.md).

### 4. Logout and revocation

`POST /auth/logout` sets `revoked_at = now()` on the `sessions` row and
deletes every `refresh_tokens` row tied to that `session_id` in a single
atomic transaction. After that point, any attempt to refresh fails, and every
sensitive-operation guard rejects the user. An already-issued JWT remains
cryptographically valid until its 15-minute `exp`, so the hot path is
stateless, but the refresh path and sensitive-op guards always re-check the
session row. See [Claim: Logout revokes all tokens bound to the session](../../wiki/claims/logout-revokes-all-tokens.md)
and the [Authentication Overview](../../wiki/authentication/overview.md).

## Grounded facts cited

- JWTs are signed with **RS256** (asymmetric, 2048-bit RSA).
- Access-token lifetime: **15 minutes**.
- Server-side sessions live in a **PostgreSQL `sessions` table**, keyed by
  a `session_id` UUID that is mirrored into an HttpOnly Secure SameSite=Lax
  cookie.
- Refresh is handled by **`POST /auth/refresh`**, backed by the PostgreSQL
  **`refresh_tokens`** table.
- Logout sets `revoked_at = now()` on the session row and deletes all bound
  refresh tokens.

## Gaps / Open Questions

- The wiki does not yet cover login itself (credential validation, MFA flow).
- No coverage of clock-skew tolerance for `exp` verification.
- No explicit documentation of refresh-token expiry length (the source
  document says "long-lived" but does not pin a number).

## Suggested next actions

- Ingest a second source covering the `/auth/login` flow.
- Promote this answer to a permanent synthesis page via `/wiki-promote` if
  frequently asked.
