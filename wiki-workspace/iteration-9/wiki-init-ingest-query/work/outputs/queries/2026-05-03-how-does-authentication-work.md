---
title: How does authentication work?
type: synthesis
question: how does authentication work?
created: 2026-05-03
topic: authentication
tags:
  - authentication
  - jwt
  - session-management
sources:
  - wiki/authentication.md
---

# How does authentication work?

## Answer

The service uses [JWT-based authentication backed by a sessions table](../../wiki/authentication.md). When a user submits credentials to `POST /auth/login`, the server validates them against the `users` table and issues two tokens: a short-lived JSON Web Token (access JWT, signed with HS256, 15-minute lifetime) and a long-lived refresh token (30 days). The refresh token's sha256 hash is persisted in the [`sessions` table](../../wiki/authentication.md), keyed by a server-generated UUID.

To exchange a refresh token for a new access JWT, clients call `POST /auth/refresh`. The service looks up the row in the sessions table by `token_hash`, requires `revoked_at IS NULL`, and mints a new JWT. Logout (`POST /auth/logout`) sets `revoked_at = now()`, which closes the refresh path immediately while letting the outstanding access JWT expire naturally on its 15-minute clock.

## Citations

- [Authentication and Session Management](../../wiki/authentication.md) — entire flow

## Knowledge gaps

None for this question — the source page covers the request/response details, the schema of the sessions table, and the revocation semantics.
