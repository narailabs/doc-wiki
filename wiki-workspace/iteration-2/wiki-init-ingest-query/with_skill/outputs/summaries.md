---
title: Wiki Summaries
type: index
tags: [backend-services, summaries]
sources: []
created: 2026-04-14
updated: 2026-04-14
quality: 0.0
summary: >
  One-paragraph abstracts for every wiki page. Loaded first during
  /wiki-query for summary-first relevance ranking before any full page
  is read.
---

# Summaries

Short abstracts for every wiki page — loaded first during `/wiki-query` before any full page is read.

## Authentication

### [auth/authentication.md](auth/authentication.md)

The service combines short-lived RS256-signed JWT access tokens (15 min expiry, verified via JWKS, carrying `sub`/`sid`/`scope` claims) with server-side sessions persisted in a PostgreSQL `sessions` table keyed by an opaque `session_id` cookie. Access tokens rotate through `/auth/refresh`, which looks up the session, matches a hashed refresh token in the `refresh_tokens` table, and rotates the refresh secret on each use; a mismatch revokes the entire session. Logout sets `revoked_at` on the session, deletes refresh-token rows, and clears the cookie — outstanding access tokens remain valid until `exp` (bounded to 15 minutes).

Tags: `authentication`, `jwt`, `session-management`, `refresh-token`, `rs256`, `postgresql`.
