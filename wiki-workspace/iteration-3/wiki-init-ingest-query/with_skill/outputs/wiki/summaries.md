# Summaries

High-level summaries of wiki topics. Load this file first when answering a
query; it carries enough context (~50 tokens per page) to decide which full
pages to load.

## Authentication

- **[Authentication & Session Management Overview](authentication/overview.md)** —
  Navigation hub for how backend services authenticate users: short-lived
  RS256 JWTs in the Authorization header, a server-side PostgreSQL `sessions`
  table keyed by a `session_id` cookie, and a `/auth/refresh` endpoint backed
  by rotating refresh tokens. Logout revokes the session row, invalidating
  every downstream token.

- **[JWT Access Tokens (RS256)](authentication/jwt.md)** —
  Every authenticated API call carries a short-lived JWT in the
  `Authorization: Bearer` header. Tokens are signed with RS256 (RSA 2048-bit);
  the auth service holds the private key and microservices hold only the
  public key. Access-token lifetime is 15 minutes; a custom `sid` claim binds
  each JWT to a server-side session record.

- **[Server-Side Sessions](authentication/sessions.md)** —
  Every logged-in user has a server-side session row in the PostgreSQL
  `sessions` table, keyed by a `session_id` UUID that is mirrored into an
  HttpOnly Secure SameSite=Lax cookie. The session row is the source of truth
  for liveness: setting `revoked_at` invalidates the session even though any
  still-valid JWT survives until its 15-minute `exp`.

- **[Refresh Endpoint and Token Lifecycle](authentication/refresh.md)** —
  Clients exchange expiring JWTs for fresh ones by posting to
  `POST /auth/refresh`. The endpoint is backed by a PostgreSQL
  `refresh_tokens` table and rotates the refresh token on every call; the
  old row's `rotated_to` field records the hash of the replacement so replay
  attempts can be detected. Logout deletes every refresh token bound to the
  session and sets `revoked_at` on the session row.

## Claims

- **[Logout revokes all tokens bound to the session](claims/logout-revokes-all-tokens.md)** —
  A single `POST /auth/logout` call sets `revoked_at` on the `sessions` row
  and deletes every associated row in `refresh_tokens`. After that point, no
  new JWT can be minted for the session; outstanding JWTs survive until their
  15-minute `exp` but fail every sensitive-operation check.
