---
query: "how does authentication work?"
asked_at: 2026-04-14
wiki_root: /tmp/eval-iiq-project
pages_considered: [wiki/auth/authentication.md, wiki/index.md, wiki/overview.md, wiki/summaries.md]
pages_loaded: [wiki/auth/authentication.md, wiki/overview.md]
relevance_scores:
  "wiki/auth/authentication.md": 0.95
  "wiki/overview.md": 0.55
  "wiki/index.md": 0.15
  "wiki/summaries.md": 0.15
---

# Query: how does authentication work?

## Answer

The service uses a **hybrid design**: stateless JWT access tokens for the request path, combined with server-side session records stored in PostgreSQL that give operators the ability to forcibly revoke access ([auth/authentication.md](../../wiki/auth/authentication.md)).

### 1. Access tokens (RS256 JWTs)

Every authenticated API call carries a **JSON Web Token signed with RS256** (RSA + SHA-256). The private signing key is held by the auth service in a secrets manager; the public keys are published at `/.well-known/jwks.json` so downstream services can verify tokens without a shared secret ([auth/authentication.md § JWT Access Tokens](../../wiki/auth/authentication.md#access-tokens-jwt--rs256)).

Token claims include:

- `sub` — the authenticated user's internal ID
- `sid` — the server-side session ID the token was minted from
- `scope` — permission scopes granted to the token
- `iat` / `exp` — issued-at and expiration timestamps
- `iss` — the auth service issuer URL

Access tokens are **short-lived (15 min default)**. That short lifetime is intentional — it is the primary revocation mechanism, so downstream services do **not** need to query the session store on every request ([auth/authentication.md](../../wiki/auth/authentication.md)).

### 2. Server-side sessions (PostgreSQL)

Every authenticated user also has a row in the PostgreSQL `sessions` table, keyed by an opaque `session_id` delivered to the client as an HTTP-only, `Secure`, `SameSite=Lax` cookie on the auth domain. The row stores `user_id`, `created_at`, `last_seen_at`, `expires_at`, `ip_address`, `user_agent`, and a nullable `revoked_at` ([auth/authentication.md § Server-Side Sessions](../../wiki/auth/authentication.md#server-side-sessions-postgresql)). Sessions enforce an absolute lifetime (default 30 days) and an idle timeout (default 7 days).

A present, non-revoked session is what authorizes the auth service to **mint new access tokens** without re-prompting for credentials ([overview.md](../../wiki/overview.md)).

### 3. Refresh flow (`/auth/refresh`)

Clients rotate access tokens via `POST /auth/refresh`, sending the `session_id` cookie ([auth/authentication.md § Refresh Flow](../../wiki/auth/authentication.md#refresh-flow-authrefresh)):

1. Auth service looks up the session row and verifies it is present, not revoked, not expired.
2. It then looks up the row in the separate `refresh_tokens` table, which stores a **hashed** refresh secret and a rotation counter.
3. If the presented refresh token does not match the stored hash, the service **revokes the entire session** — this is the defense against refresh-token theft.
4. On success, the refresh token is rotated (new random value, new hash stored, old hash invalidated) and a new JWT is minted. Both are returned to the client.

### 4. Logout / invalidation

On logout the auth service:

1. Sets `revoked_at = now()` on the session row.
2. Deletes all rows in `refresh_tokens` for the session.
3. Clears the `session_id` cookie on the client.

Existing access tokens still validate cryptographically until their `exp` passes (up to 15 minutes), but no new ones can be minted from the revoked session. This bounded-window tradeoff keeps the hot path stateless while keeping revocation latency to at most one token lifetime ([auth/authentication.md § Logout / session invalidation](../../wiki/auth/authentication.md#logout--session-invalidation)).

## TL;DR

**Login mints both a `session_id` cookie and a short-lived RS256 JWT. Every API call carries the JWT; every 15 minutes the client calls `/auth/refresh` (with the cookie) to rotate the JWT and refresh-token hash. Logout revokes the PostgreSQL session row and deletes refresh-tokens, so within one token lifetime no further access is possible.**

## Citations

- [wiki/auth/authentication.md](../../wiki/auth/authentication.md) — full page on hybrid JWT + session-cookie design
- [wiki/overview.md](../../wiki/overview.md) — high-level architectural summary
- [raw/auth/architecture.md](../../raw/auth/architecture.md) — original source document

## Knowledge gaps / follow-ups

The wiki does not yet cover:

- **Login itself** (credential exchange, MFA, social-login). The page describes what happens *after* a session exists, but not how one is first created.
- **JWKS key rotation mechanics** — how long keys stay published, how the service signals rollover to downstream verifiers.
- **Scope derivation** — how `scope` claims on the JWT are computed from user/role data.
- **Anomaly-driven revocation** — the `ip_address` and `user_agent` columns suggest an anomaly pipeline, but it is not documented.

Consider ingesting additional source docs covering login and key management, or running `/wiki-promote` on this query if the gaps can be filled.
