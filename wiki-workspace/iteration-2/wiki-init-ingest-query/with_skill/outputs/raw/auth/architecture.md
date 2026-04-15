# Authentication Architecture

This document describes the authentication and session management architecture for the service. The design combines short-lived JWT access tokens with server-side session tracking to balance statelessness on the application tier with the ability to forcibly invalidate user sessions on demand.

## JWT Access Tokens

The service issues JSON Web Tokens (JWTs) as its primary access credential for authenticated API requests. All access tokens are signed with **RS256** (RSA signature with SHA-256), using an asymmetric key pair. The private key is stored in a secrets manager and is only accessible to the auth service; public keys are published at a JWKS (`/.well-known/jwks.json`) endpoint so that downstream services can verify tokens without a shared secret.

Access tokens are short-lived — the default expiry is 15 minutes. Each token carries the following claims:

- `sub` — the authenticated user's internal ID
- `sid` — the server-side session ID this token belongs to
- `scope` — an array of permission scopes granted to the token
- `iat` / `exp` — issued-at and expiration timestamps
- `iss` — the auth service issuer URL

Downstream services are expected to verify the JWT signature against the JWKS, check `exp`, and enforce scope requirements on each request. They are *not* expected to query the session store on every request; the short token lifetime is what bounds revocation latency.

## Server-Side Sessions

In addition to the stateless JWT, the service maintains a **server-side session record** for every authenticated user. The session is keyed by an opaque `session_id` value set as an HTTP-only, `Secure`, `SameSite=Lax` cookie on the auth domain. Sessions are persisted in **PostgreSQL** in a `sessions` table with the following columns:

- `session_id` (UUID, primary key)
- `user_id` (FK to `users.id`)
- `created_at`, `last_seen_at`, `expires_at` (timestamps)
- `ip_address`, `user_agent` (for audit and anomaly detection)
- `revoked_at` (nullable; set when a session is explicitly invalidated)

Sessions have a configurable absolute lifetime (default 30 days) and an idle timeout (default 7 days). When a session is present and valid, the auth service trusts it to mint new access tokens without requiring the user to re-enter credentials.

## Refresh Flow

Because access tokens are short-lived, clients rotate them via the `/auth/refresh` endpoint. The refresh flow works as follows:

1. The client calls `POST /auth/refresh` with the `session_id` cookie attached.
2. The auth service looks up the session row in the `sessions` table.
3. If the session exists, is not revoked, and has not expired, the service looks up the associated entry in a separate `refresh_tokens` table. The refresh-token row stores a hashed refresh secret and a rotation counter; if the presented refresh token does not match the current hash, the entire session is revoked (this protects against refresh-token theft).
4. On a valid refresh, the service rotates the refresh token (new random value, hash stored, old hash invalidated), mints a new JWT access token, and returns both to the client.

On **logout**, the auth service invalidates the session by setting `revoked_at = now()` on the session row, deleting all associated refresh-token rows, and clearing the `session_id` cookie on the client. Existing access tokens will still validate cryptographically until they expire (up to 15 minutes later), but no new ones can be minted from the revoked session.
