---
title: Authentication and Session Management
type: concept
status: supported
created: 2026-05-03
updated: 2026-05-03
sources:
  - raw/architecture.md
summary: JWT-based authentication backed by a sessions table holding revocable refresh tokens; access tokens are short-lived (15 min) and refresh tokens persist for 30 days.
tags:
  - authentication
  - jwt
  - session-management
  - refresh-token
  - access-token
  - revocation
---

# Authentication and Session Management

## Overview

This service authenticates users with stateless JSON Web Tokens (JWT) and persists revocable refresh tokens in a `sessions` table. JWT access tokens are signed with HS256 and live for 15 minutes; refresh tokens are valid for 30 days and can be revoked instantly.

## Authentication Flow

1. Clients submit credentials to `POST /auth/login`.
2. The service validates against the `users` table.
3. On success it issues two tokens: a short-lived access JWT and a long-lived refresh token.
4. The refresh token's hash is persisted in the `sessions` table.

## Sessions Table

The `sessions` table is the durable component. Each row holds:

- `id` — UUID primary key
- `user_id` — foreign key to `users`
- `token_hash` — sha256 of the refresh token (raw token never stored)
- `created_at`, `expires_at` — lifetime window
- `revoked_at` — nullable; set on logout

## Refresh Endpoint

`POST /auth/refresh` looks up the row by `token_hash`, requires `revoked_at IS NULL`, and mints a new JWT. Once a session is revoked, refresh attempts using that token fail closed.

## Logout

`POST /auth/logout` writes `revoked_at = now()` to the corresponding session row. The outstanding JWT remains valid until it expires (max 15 minutes), but no new JWTs can be minted from that refresh token.

## Endpoints

| Path | Purpose |
|---|---|
| `POST /auth/login` | Issue access + refresh tokens |
| `POST /auth/refresh` | Exchange refresh token for new JWT |
| `POST /auth/logout` | Revoke the session |
| `GET /auth/me` | Return user identity from JWT |

## Security Notes

- HS256 signing key loaded from `JWT_SECRET` environment variable.
- Refresh tokens never stored in plaintext — only their sha256 digest.
- All `auth/*` endpoints rate-limited to 10 req/min per IP.

## Related Pages

(auto-managed by the crosslink hook)
