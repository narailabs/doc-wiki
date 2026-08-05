---
title: JWT Access Tokens (RS256)
type: concept
tags: [jwt, rs256, authentication, asymmetric-signing, access-tokens]
sources: [raw/docs/architecture.md]
created: 2026-04-14
updated: 2026-04-14
quality: 0.0
summary: >
  Every authenticated API call carries a short-lived JWT in the
  `Authorization: Bearer` header. Tokens are signed with RS256 (RSA 2048-bit);
  the auth service holds the private key and microservices hold only the
  public key. Access-token lifetime is 15 minutes; a custom `sid` claim binds
  each JWT to a server-side session record.
---

# JWT Access Tokens (RS256)

## Signing Scheme

We use **RS256** (RSA with SHA-256, asymmetric signing). The authentication
service holds the private RSA key (2048 bits) and is the only component that
can mint tokens. Every downstream microservice holds only the public key and
verifies the signature locally — no network round-trip to the auth service on
the hot path.

This is deliberately not HS256. With HS256 the signing secret would have to be
distributed to every verifier, which means a single compromised microservice
could mint valid tokens for every other service. With RS256 a compromised
verifier can only verify, not forge.

## Claims

Each JWT payload carries:

| Claim | Meaning |
|---|---|
| `sub` | The user ID. |
| `iat` | Issued-at timestamp. |
| `exp` | Expiration (typically `iat + 15m`). |
| `iss` | Issuer; verifiers must reject unexpected issuers. |
| `sid` | Custom claim: the `session_id` UUID pointing at a row in the
  server-side `sessions` table. |

The `sid` claim is the thread that links otherwise-stateless JWTs back to the
stateful world of [server-side sessions](./sessions.md).

## Lifetime

Access tokens live 15 minutes. This is short enough that a leaked token
expires before most attacker playbooks can chain it into durable access, but
long enough that clients rarely have to refresh mid-request-batch. When a
token expires the client calls the [refresh endpoint](./refresh.md), never
the login endpoint again.

## Verification Checklist

Every downstream verifier must:

1. Check the RS256 signature against the published public key.
2. Check `exp` against the current wall clock.
3. Check `iss` against the expected issuer for this environment.
4. Optionally consult the `sessions` table by `sid` — mandatory for sensitive
   operations (password change, email change, logout).

## Related Pages

- [Authentication Overview](./overview.md)
- [Server-Side Sessions](./sessions.md)
- [Refresh Endpoint](./refresh.md)
- [Claim: Logout Revokes All Tokens](../claims/logout-revokes-all-tokens.md)

## How to Go Deeper

- **Raw source:** [raw/docs/architecture.md](../../raw/docs/architecture.md)
- **Spec lookup:** See RFC 7519 for JWT and RFC 7518 for RS256.
