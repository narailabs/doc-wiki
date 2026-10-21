---
title: Authentication Flow
type: synthesis
status: supported
created: 2026-05-03
updated: 2026-05-03
topic: authentication-flow
sources:
  - https://example.com/internal/auth-spec
  - ../../raw/auth-architecture.md
summary: End-to-end JWT authentication flow including login, refresh, and logout, plus the mTLS path used for service-to-service traffic.
tags:
  - authentication
  - jwt
  - session
  - refresh-token
  - mtls
quality: 0.6
---

# Authentication Flow

## Overview

Authentication in this service rests on JSON Web Tokens (JWTs). When a client posts to the login endpoint, the auth service validates credentials against the users table and issues two tokens: a short-lived access JWT signed with HS256 (15-minute expiry) and a longer-lived refresh token. The refresh token's sha256 hash is persisted in the sessions table so the server can revoke it later.

## Refresh Path

Refreshing an expired access token routes through the auth service's `POST /auth/refresh` endpoint. The service looks up the refresh token's hash in the sessions table, requires `revoked_at IS NULL`, and mints a fresh access JWT.

## Logout / Revocation

Logging out (via `POST /auth/logout`) sets `revoked_at = now()` on the corresponding session row. That kills the refresh path immediately, while the outstanding access token stays valid until its 15-minute clock expires naturally.

## Service-to-Service Auth

For service-to-service calls inside the cluster, the system uses mTLS with short-lived certificates issued by the internal CA. JWTs are reserved for end-user authentication.

## Citations

- [Auth architecture spec (external)](https://example.com/internal/auth-spec)
- [raw/auth-architecture.md](../../raw/auth-architecture.md)

## Provenance

Promoted from outputs/queries/2026-04-14-how-does-authentication-work.md on 2026-05-03.
