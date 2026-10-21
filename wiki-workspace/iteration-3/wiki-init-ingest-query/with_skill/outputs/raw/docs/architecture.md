# Authentication & Session Architecture

This document describes how our backend services authenticate users and maintain
their session state across HTTP requests. It covers the JWT access-token
lifecycle, the server-side session records that back it, and the refresh-token
endpoint that keeps logins fresh without forcing users to re-enter credentials.

## 1. JWT Access Tokens (RS256)

All authenticated API calls carry a short-lived JSON Web Token (JWT) in the
`Authorization: Bearer <token>` header. The tokens are signed with **RS256**
(RSA asymmetric signatures, 2048-bit key). The auth service holds the private
key and issues tokens; every downstream microservice holds only the public key
and verifies the signature without a round-trip to the auth service. The JWT
payload carries a standard set of claims: `sub` (user id), `iat`, `exp`
(access tokens live 15 minutes), `iss`, and a custom `sid` claim that points to
the server-side session record described below. Signing with RS256 rather than
HS256 matters because downstream services never see the signing secret — a
compromised microservice cannot mint new tokens, only verify them.

## 2. Server-Side Session Records

Although JWTs are self-contained, every logged-in user also has a server-side
session record stored in **PostgreSQL**, in the `sessions` table. Each row is
keyed by a `session_id` UUID that is mirrored into an HTTP-only, Secure,
SameSite=Lax cookie of the same name. The cookie is set on successful login and
sent on every subsequent request; the server looks up the matching session row
on sensitive operations (password change, email change, token refresh) to
confirm the session has not been revoked. The `sessions` table schema includes:
`session_id UUID PRIMARY KEY`, `user_id BIGINT NOT NULL`, `created_at
TIMESTAMPTZ`, `last_seen_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ`,
`user_agent TEXT`, `ip_address INET`, and `revoked_at TIMESTAMPTZ NULL`.
Indexing `(user_id, revoked_at)` lets us quickly list a user's active sessions
for the "log out other devices" feature. Because the session record is the
source of truth for liveness, we can revoke a session immediately on logout or
suspected compromise even though any still-valid JWT the user holds cannot be
individually revoked before its 15-minute expiry — a deliberate
availability-vs-security trade-off.

## 3. The /auth/refresh Endpoint

Clients exchange an expiring access token for a new one by calling
**POST /auth/refresh**. The endpoint reads the `session_id` cookie and a
long-lived `refresh_token` that was set on login. Both are looked up: the
session row must exist and be un-revoked, and the refresh token must match the
hash stored in the `refresh_tokens` table (schema: `token_hash BYTEA PRIMARY
KEY`, `session_id UUID REFERENCES sessions`, `issued_at TIMESTAMPTZ`,
`expires_at TIMESTAMPTZ`, `rotated_to TEXT NULL`). On a valid refresh, the
server rotates the refresh token (the old row's `rotated_to` field is set to
the hash of the new token so that replay attempts can be detected), mints a
new 15-minute JWT access token, and returns both to the client. On logout
(`POST /auth/logout`), the server sets `revoked_at = now()` on the session row
and deletes all refresh tokens bound to that `session_id`, invalidating every
device in one atomic write. This design keeps the hot path (signature verify)
stateless while retaining the ability to invalidate on demand via the cookie
lookup.
