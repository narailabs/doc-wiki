---
title: Logout revokes all tokens bound to the session
type: claim
tags: [authentication, session-management, revocation, logout, refresh-tokens]
sources: [raw/docs/architecture.md]
created: 2026-04-14
updated: 2026-04-14
quality: 0.0
status: supported
confidence: 0.9
evidence:
  - source: raw/docs/architecture.md
    type: supports
    strength: strong
    detail: >
      architecture.md §3 states: "On logout (POST /auth/logout), the server
      sets revoked_at = now() on the session row and deletes all refresh
      tokens bound to that session_id, invalidating every device in one
      atomic write."
summary: >
  A single `POST /auth/logout` call sets `revoked_at` on the `sessions` row
  and deletes every associated row in `refresh_tokens`. After that point,
  no new JWT can be minted for the session; outstanding JWTs survive until
  their 15-minute `exp` but fail every sensitive-operation check.
---

# Claim: Logout revokes all tokens bound to the session

## Statement

`POST /auth/logout` is a single atomic operation that invalidates every
authentication artifact tied to the session: the `sessions` row is marked
revoked, and every row in `refresh_tokens` with the same `session_id` is
deleted.

## Evidence

Direct quote from the source document ([raw/docs/architecture.md](../../raw/docs/architecture.md)):

> On logout (POST /auth/logout), the server sets `revoked_at = now()` on the
> session row and deletes all refresh tokens bound to that `session_id`,
> invalidating every device in one atomic write.

## Caveats

- Any JWT already issued and still under its 15-minute `exp` remains
  **cryptographically** valid. It will be rejected by any code path that
  re-consults the `sessions` row (refresh, sensitive operations), but a
  pure-stateless verifier that only checks the signature will still accept
  it until `exp`. See [JWT Access Tokens](../authentication/jwt.md) for the
  verifier contract.

## Related Pages

- [Authentication Overview](../authentication/overview.md)
- [Server-Side Sessions](../authentication/sessions.md)
- [Refresh Endpoint](../authentication/refresh.md)
