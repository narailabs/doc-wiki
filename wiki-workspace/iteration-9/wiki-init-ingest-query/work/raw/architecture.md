# Authentication & Session Architecture

This service implements JWT-based authentication with session management.

## Overview

The service uses JWT (JSON Web Tokens) for stateless authentication tokens
and a sessions table for revocable refresh tokens. JWTs are signed with
HS256 and have a 15-minute expiry.

## Authentication Flow

1. User submits credentials via POST /auth/login
2. Service validates credentials against the users table
3. On success: issues a short-lived JWT access token (15 min) and a
   long-lived refresh token (30 days)
4. Refresh token is persisted in the sessions table with a server-generated id

## Session Management

The `sessions` table stores active refresh tokens. Each row has:

- `id` (UUID, primary key)
- `user_id` (FK to users)
- `token_hash` (sha256 of refresh token)
- `created_at`, `expires_at`
- `revoked_at` (nullable)

When a refresh token is used at `POST /auth/refresh`, the service looks up
the row by `token_hash`, checks `revoked_at IS NULL`, then mints a new JWT.

## Logout / Revocation

`POST /auth/logout` sets `revoked_at = now()` on the session row, instantly
invalidating the refresh token. The JWT remains valid until expiry.

## Endpoints

- `POST /auth/login` — issue tokens
- `POST /auth/refresh` — exchange refresh token for new JWT
- `POST /auth/logout` — revoke session
- `GET /auth/me` — return current user from JWT

## Security Notes

- JWTs are signed with HS256 using a secret loaded from `JWT_SECRET` env var
- Refresh tokens are stored hashed (never plaintext)
- All auth endpoints rate-limited at 10 req/min per IP
