---
title: How does authentication work?
type: synthesis
question: how does authentication work?
created: 2026-04-14
topic: authentication
tags:
  - authentication
  - jwt
  - session
sources:
  - https://example.com/internal/auth-spec
  - raw/auth-architecture.md
---

# How does authentication work?

## Answer

Authentication in this service rests on JSON Web Tokens (JWTs). When a client posts to the login endpoint, the auth service validates credentials against the users table and issues two tokens: a short-lived access JWT signed with HS256 (15-minute expiry) and a longer-lived refresh token. The refresh token's sha256 hash is persisted in the sessions table so the server can revoke it later.

Refreshing an expired access token routes through the auth service's `POST /auth/refresh` endpoint. The service looks up the refresh token's hash in the sessions table, requires `revoked_at IS NULL`, and mints a fresh access JWT.

Logging out (via `POST /auth/logout`) sets `revoked_at = now()` on the corresponding session row. That kills the refresh path immediately, while the outstanding access token stays valid until its 15-minute clock expires naturally.

For service-to-service calls inside the cluster, the system uses mTLS with short-lived certificates issued by the internal CA. JWTs are reserved for end-user authentication.

## Citations

- [Auth architecture spec](https://example.com/internal/auth-spec)
- raw/auth-architecture.md

## Knowledge gaps

- The current document doesn't describe the rate-limit ladder or how auth failures interact with abuse-prevention.
