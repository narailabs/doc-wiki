---
title: Wiki Overview
type: synthesis
tags: [backend-services, authentication, hybrid-auth]
sources: [wiki/auth/authentication.md]
created: 2026-04-14
updated: 2026-04-14
quality: 0.0
summary: >
  Evolving big-picture synthesis of the eval-iiq-project backend. Currently
  covers the authentication subsystem (hybrid JWT + server-side session
  design); will grow to cover data, messaging, and deployment over time.
---

# Overview

Domain: **backend-services**.

The wiki currently covers a single topic: **authentication and session management**. The service is a hybrid-auth design — stateless JWT access tokens for the request path, stateful PostgreSQL-backed sessions for the control plane (revocation, logout, anomaly response). See [auth/authentication.md](auth/authentication.md) for the full page.

Key architectural choices captured so far:

- **RS256 JWTs, JWKS verification** — downstream services verify tokens without sharing a secret with the auth service.
- **15-minute access token expiry** — the short lifetime bounds revocation latency, removing the need for per-request session lookups in downstream services.
- **PostgreSQL `sessions` table** — server-side sessions hold IP, user-agent, timestamps, and an optional `revoked_at`. Logout flips `revoked_at` and nukes refresh tokens.
- **Rotating refresh tokens in a separate table** — any hash mismatch revokes the whole session (refresh-token-theft defense).

As the wiki grows, add sibling pages under `wiki/` for other backend-services concerns (data storage, messaging, deployment topology) and update this overview to connect them.

## Related Pages

- [Index](index.md)
- [Summaries](summaries.md)
- [auth/authentication.md](auth/authentication.md)
